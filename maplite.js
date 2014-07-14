/**
 * Maplite jQuery Widget
 * This data viewer plugin is the central router for data display related functions
 * 
 * TODO: add disclaimers, boilerplating, etc
 * 
 * Public API reference
 * ------- USAGE -------
 * $( DIV_SELECTOR ).regionalDataViewer( { ARG1, ARG2, ... } );
 * 
 * Note: the div must have sizing styles applied to it
 * 
 * ---- CONSTRUCTOR ----
 * Parameters
 *   baseLayer: OpenLayers.Layer       A single base layer for the map
 *   layers: [OpenLayers.Layer, ...]   An array of data layers to overlay on the map
 *   extent: OpenLayers.Bounds         Initial extent of map
 * 
 * Returns
 *   this
 * 
 * ------ METHODS ------
 * All methods are exposed via reflection through the widget reference
 * Example
 *   $( DIV_SELECTOR ).mapLite( 'myMethodName', ARG1, ARG2, ... );
 * 
 * Command methods (return this for chaining)
 * 
 * Getters (return the requested value)
 * 
 */

(function($, document){
    
    // private constants
    var ICON_PATH = 'markers/24/';
    var ICON_EXTENSION = '.png';
    var UNITS = 'm';
    var PROJECTION = 'EPSG:900913';
    var SELECTED_LAYER_NAME = 'lyr_selected';
    
    var MARKER_COLORS = {
        RED: {hex: '#fb6254'},
        GREEN: {hex: '#00e03c'},
        BLUE: {hex: '#4462c8'},
        CYAN: {hex: '#54d6d6'},
        PURPLE: {hex: '#7d54fb'},
        YELLOW: {hex: '#fcf357'}
    };
    
    function MapliteDataSource( url, name, id, color, projection, styleMap, filter ) {
        this.url = url;
        this.name = name;
        this.id = id;
        this.color = color;
        this.projection = projection;
        this.styleMap = styleMap;
        if ( typeof filter !== 'undefined' && filter !== null ) {
            this.filter = filter;
        } else {
            this.filter = function( zoom, layer ) {
                return layer;
            };
        }
    }

/*
 * The following is a fix for some odd behavior when a WMS layer is configred as 4326.
 * Some background on the behavior:
 * 1) If a WMS overlay in the config doesn't have a projection specified, it 
 *    uses the map default (currently 900913). One can see that the request goes
 *    through to the service with 900913, and everything is good.
 * 2) If a WMS overlay has another SRS defined like EPSG:3857, the layer is 
 *    configured using that code as expected. One can see that the request goes
 *    through to the serivce with 3857, and everything is good.
 * 3) If a WMS overlay uses 4326, the layer is configured using that code as 
 *    expected. HOWEVER, when the WMS request is made, one can see from the traffic
 *    that the request uses the EPSG code of 102100... Where does this come from?
 *    Presumably the base layer that uses 102100. Why is this behavior inconsistent
 *    given items 1 and 2 above? I have no idea. But, in come cases, the WMS is
 *    configured to allow reuqests for 4326 and for 102100 (which is why this was
 *    not previously noticed). Recently, I encountered a service howerver that
 *    exposed 4326 but NOT 102100. OL helpfully continued requesting 102100 and
 *    the service rejected the request.
 * 
 * What follows is forcing OL to request 4326 when it thinks 102100 is what we want.
 * 
 */
    OpenLayers.Layer.WMS.prototype.getFullRequestString = function( newParams, altUrl ) {
        var thisProj = this.projection.toString();
        
        if ( thisProj === 'EPSG:4326' ) {
            var baseProj = this.map.baseLayer.projection.toString();
            this.params.SRS = thisProj;
            var request = OpenLayers.Layer.Grid.prototype.getFullRequestString.apply( this, arguments );
            var bbox = request.match(/BBOX=([^&]+)/)[1].split( ',' );
            var bounds = new OpenLayers.Bounds( bbox );
            bounds = bounds.transform( new OpenLayers.Projection( baseProj ), new OpenLayers.Projection( thisProj ) );
            request = request.replace( bbox, bounds.toString() );
            return request;
        } else {
            // !!!!!!!!!!!!!!!!!!!!!!!!!!!
            // THIS IS THE DEFAULT BEHAVIOR AS TAKEN DIRECTLY FROM THE SOURCE
            // !!!!!!!!!!!!!!!!!!!!!!!!!!!
            var mapProjection = this.map.getProjectionObject();
            var projectionCode = this.projection && this.projection.equals(mapProjection) ? this.projection.getCode() : mapProjection.getCode();
            var value = (projectionCode === "none") ? null : projectionCode;
            if (parseFloat(this.params.VERSION) >= 1.3) {
                this.params.CRS = value;
            } else {
                this.params.SRS = value;
            }
            
            if (typeof this.params.TRANSPARENT === "boolean") {
                newParams.TRANSPARENT = this.params.TRANSPARENT ? "TRUE" : "FALSE";
            }
            
            return OpenLayers.Layer.Grid.prototype.getFullRequestString.apply(this, arguments);
        }  
    };
    
/*
 * End kluge
 */
    
    $.widget( 'nemac.mapLite', {
        //----------------------------------------------------------------------
        // Defaults
        //----------------------------------------------------------------------
        options: {
            config: null, // if config provided, will override any parameters included
            layers: { bases: [ new OpenLayers.Layer.XYZ(
                'OSM (with buffer)',
                [
                    'http://a.tile.openstreetmap.org/${z}/${x}/${y}.png',
                    'http://b.tile.openstreetmap.org/${z}/${x}/${y}.png',
                    'http://c.tile.openstreetmap.org/${z}/${x}/${y}.png'
                ], {
                    transitionEffect: 'resize',
                    buffer: 2,
                    sphericalMercator: true
                }) 
            ], maplite: [], overlays: {}, groups: [] },
            mapOptions: {},
            useLayerSelector: true,
            iconPath: ICON_PATH,
            zoomCallback: null,
            moveCallback: null,
            priorityDataKey: 'weight',
            selectCallback: null,
            selectedColor: MARKER_COLORS.BLUE,
            changeOpacityCallback: null,
            layerToggleCallback: null,
            baseLayerSelectCallback: null,
            groupSelectCallback: null
        },
        
        //----------------------------------------------------------------------
        // Private vars
        //----------------------------------------------------------------------
        layers: { bases: [], maplite: [], overlays: {}, groups: [] },
        selectLayer: null,
        mapliteLayerCache: {},
        pointHash: {},
        selectedPoints: {},
        map: null,
        selectControl: null,
        filters: {},
        
        //----------------------------------------------------------------------
        // Private methods
        //----------------------------------------------------------------------
        _create: function() {
            // is external config file-driven?
            if ( this.options.config !== null && typeof this.options.config === 'object' ) {
                var instance = this;
                MapConfig( this.options.config ).done( function( options, mapOptions, layers ) {
                    $.extend( instance.options, options );
                    $.extend( instance.options.mapOptions, mapOptions );
                    $.extend( true, instance.layers, instance.options.layers, layers );
                    instance._initApp();
                }).fail( function() {
                    $(instance.element[0]).append('<b>Error loading map configuration.</b>');
                });
            } else {
                this.layers = this.options.layers;
                this._initApp();
            }
        },
        
        _initApp: function() {
            // prepare layers
            var defaultBase = this.layers.bases[0];
            
            $.each( this.layers.bases, function(){
                $.extend( {}, this, { isBaseLayer: true });
                if ( this.isDefault ) defaultBase = this;
            });
            
            // init map
            this.map = this._deployMap( this.layers.bases );
            
            // request maplite layers
            if ( this.layers.maplite.length > 0 ) {
                var instance = this;
                var requests = [];
                
                $.each( this.layers.maplite, function( i, mapliteLayer ) {
                    requests.push(
                        $.get( mapliteLayer.url )
                        .success( function( points ){
                            instance.filters[mapliteLayer.id] = instance._buildFilterFunctionCache( mapliteLayer.filter, points );
                            instance.pointHash[mapliteLayer.id] = instance._hashPoints( points );
                        })
                    );
                });
                
                $.when.apply( $, requests ).done( function() {
                    instance._scaleMapliteMarkers();
                    
                    // do the rest of the deployment -- this is to avoid a race condition that sometimes happens with openlayers
                    if ( instance.options.useLayerSelector ) instance._buildLayerSwitcher();
                    instance.setBaseLayer( defaultBase.id );
                    
                    if (instance.options.onCreate !== null && typeof instance.options.onCreate === 'function' ) {
                        instance.options.onCreate(instance);
                    }
                });
                
            } else {
                if ( this.options.useLayerSelector ) this._buildLayerSwitcher();
                this.setBaseLayer( defaultBase.id );
            }
        },
        
        _buildLayerSwitcher: function() {
            // deploy minimized state
            $( 'body' ).append( '<div id="mlMaximizeLayerSwitcher" class="mlMaximize mlSwitcher mlSelect">\n\
                                     <img src="img/layer-switcher-maximize.png"></img>\n\
                                     <span class="layerPickerLabel overlayLabel">Data</span>\n\
                                 </div>');
            
            $( '#mlMaximizeLayerSwitcher' ).on( 'click', function(){
                $( '#mlMaximizeLayerSwitcher' ).hide();
                $( '#mlLayerSwitcher' ).show();
            });
                        
            // deploy maximized state
            $( 'body' ).append( '<div id="mlLayerSwitcher" class="mlSwitcher mlLayersDiv">\n\
                                     <div id="mlMinimizeLayerSwitcher" class="mlMinimize mlSelect">\n\
                                         <img src="img/layer-switcher-minimize.png"></img>\n\
                                     </div>\n\
                                     <div id="mlLayerList"></div>\n\
                                 </div>');
            
            $( '#mlMinimizeLayerSwitcher' ).on( 'click', function(){
                $( '#mlLayerSwitcher' ).hide();
                $( '#mlMaximizeLayerSwitcher' ).show();
            });
            
            var instance = this;
            
            // base layers
            if ( this.layers.bases.length > 1 ) {
                $( '#mlLayerList' ).append( '<span class="mlDataLbl">Base Layers</span><div class="mlLayerSelect"><select id="mlBaseList"></select></div>' );
                
                var baseList = '';
                $.each( this.layers.bases, function() {
                    baseList += '<option value="' + this.id + '">' + this.name + '</option>';
                });
                                
                $( '#mlBaseList', '#mlLayerList').append( baseList ).on( 'change', function(){
                    instance.setBaseLayer( $(this).val() );
                    
                    if (instance.options.baseLayerSelectCallback !== null && typeof instance.options.baseLayerSelectCallback === 'function' ) {
                        instance.options.baseLayerSelectCallback( $(this).val() );
                    }
                });
            }
            
            // groups
            var defaultGroup = this.layers.groups[0];
            
            // TODO parameterize the group label
            $( '#mlLayerList' ).append( '<span id="mlGroupLabel" class="mlDataLbl">Topics</span><div class="mlLayerSelect"><div id="mlGroupLayers"></div></div>' );
            if ( this.layers.groups.length > 1 ) {
                $( '#mlGroupLayers', '#mlLayerList' ).before('<select id="mlGroupList"></select>');
                
                var groupList = '';
                $.each( this.layers.groups, function() {
                    groupList += '<option value="' + this.id + '">' + this.name + '</option>';
                    if ( this.isDefault ) defaultGroup = this;
                });
                
                $( '#mlGroupList', '#mlLayerList').append( groupList ).on( 'change', function(){
                    instance._setGroup( $(this).val() );
                    
                    if (instance.options.groupSelectCallback !== null && typeof instance.options.groupSelectCallback === 'function' ) {
                        instance.options.groupSelectCallback( $(this).val() );
                    }
                });
            } else if ( this.layers.groups.length === 1 ) {
                $( '#mlGroupLabel', '#mlLayerList').text( this.layers.groups[0].name );
            }
            instance._setGroup( defaultGroup.id );
            
            // attach transparency slider (used by individual overlays)
            
            $( '#mlLayerSwitcher' ).hide();
            
            $( '#OpenLayers_Control_MaximizeDiv', this.element[0] ).append( '<span class="layerPickerLabel overlayLabel">Data</span>' );
            
            $( this.element[0] ).append( '<div id="sliderContainer">\n\
                                    <div id="opacitySlider"></div>\n\
                                    <div class="sliderLabelContainer">\n\
                                       <span class="suffix">Transparent</span><span id="transparencyLevel">0%</span>\n\
                                    </div>\n\
                                    <div class="clear"></div>\n\
                                 </div>' );

            $( '#opacitySlider').slider({
                min: 0,
                max: 100
            });
            
            $( '#sliderContainer' ).hide();
        },
        
        _setGroup: function( groupId ) {
            var group = null;
            $.each( this.layers.groups, function(){
                if ( this.id === groupId ) {
                    group = this;
                    return false;
                }
            });
            
            if ( group === null ) return;
            
            $( '#mlGroupList', '#mlLayerList').val( groupId );

            var instance = this;
            
            // kill all current layers
            $( 'input', '#mlGroupLayers' ).each( function(){
                if ( $(this).is(':checked') ) {
                    $( this ).attr( 'checked', false );
                    var lyr = this.id.replace( 'chk_', '');
                    instance.setLayerVisibility( lyr, false );
                    
                    if (instance.options.layerToggleCallback !== null && typeof instance.options.layerToggleCallback === 'function' ) {
                        instance.options.layerToggleCallback( lyr, false );
                    }
                }
            });

            $( '#mlGroupLayers' ).empty();
            
            if ( group.hasOwnProperty( 'layers' ) ) {
                $.each( group.layers, function() {
                    instance._deployLayerSelect( $( '#mlGroupLayers', '#mlLayerList' ), instance.layers.overlays[this] );
                });
            }
            
            if ( group.hasOwnProperty( 'subGroups') ) {
                $.each( group.subGroups, function() {
                    $( '#mlGroupLayers', '#mlLayerList' ).append( '<span class="mlDataLbl">' + this.name + '</span>' );
                    $.each( this.layers, function() {
                        instance._deployLayerSelect( $( '#mlGroupLayers', '#mlLayerList' ), instance.layers.overlays[this] );
                    });
                });
                            
            };
            
            // bind click
            $( 'input', '#mlGroupLayers' ).click( function() {
                var lyr = this.id.replace( 'chk_', '' );
                instance._addOverlay( lyr );
                instance.setLayerVisibility( lyr, this.checked );
                
                if (instance.options.layerToggleCallback !== null && typeof instance.options.layerToggleCallback === 'function' ) {
                    instance.options.layerToggleCallback( lyr, this.checked );
                }
            });
            
            // bind open opacity slider
            $( 'img', '#mlGroupLayers' ).click( function( e ) {
                var lyr = this.id.replace( 'cfg_', '' );
                
                $( '#sliderContainer' )
                    .show( 300 ).offset({
                        left: e.pageX,
                        top: e.pageY - 20 })
                    .find( 'a' )
                    .off( 'blur' )
                    .on( 'blur', function(){
                        $( '#sliderContainer' ).hide( 'highlight', { color: '#ffffff' }, 300 ); })
                    .focus();
                
                $( '#opacitySlider').off( 'slide' );
                
                var opacity = Math.round( 100 - instance.getLayerOpacity( lyr ) * 100 );
                
                $( '#opacitySlider')
                    .off( 'slide' )
                    .on( 'slide', function( e, ui ) {
                        var val = Math.round(ui.value);
                        $( '#transparencyLevel' ).text( val + "%" );
                        instance.setLayerOpacity( lyr, 1 - val / 100 ); })
                    .off( 'slidestop' )
                    .on( 'slidestop', function( e, ui ) {
                        $( '#sliderContainer' ).hide( 'highlight', { color: '#ffffff' }, 300 );
                        
                        var val = Math.round(ui.value);
                    
                        if (instance.options.changeOpacityCallback !== null && typeof instance.options.changeOpacityCallback === 'function' ) {
                            instance.options.changeOpacityCallback( lyr, 1 - val / 100 );
                        } })
                    .slider( 'value', opacity );
                
                $( '#transparencyLevel' ).text( opacity + "%" );
            });
        },
        
        _deployLayerSelect: function( $ref, layer ) {
            var id = layer.id;
            var name = layer.name;
            $( $ref ).append( '<div class="mlLayerSelect"><input id="chk_' + id + '" type="checkbox"></input><label for=chk_' + id + '>' + name + '</label><img id="cfg_' + id + '" class="mlCfg" src="img/settings.png"></img></div>' );
            this.setLayerVisibility( id, false );
        },
                
        // map creation helpers
        
        _deployMap: function( initialLayers ) {
            var mapBaseOptions = {
                div: this.element[0],
                units: UNITS,
                layers: initialLayers,
                zoom: 4,
                center: [-10500000, 4500000],
                controls: [
                    new OpenLayers.Control.Navigation({
                        dragPanOptions: {
                            enableKinetic: true
                        }
                    }),
                    new OpenLayers.Control.Zoom()
                ],
                projection: new OpenLayers.Projection( PROJECTION )
            };

            var olMap = new OpenLayers.Map($.extend( {}, mapBaseOptions, this.options.mapOptions));
            
            if ( typeof this.options.zoomCallback === 'function' ) {
                olMap.events.register("zoomend", olMap, this.options.zoomCallback);
            }

            if ( typeof this.options.moveCallback === 'function' ) {
                var self = this;
                olMap.events.register("moveend", olMap, 
                    function() {
                        self.options.moveCallback(self.getCenterAndZoom());
                    });
            }
            
            // when map zooms, redraw layers as needed
            var self = this;
            olMap.events.register("zoomend", this, self._scaleMapliteMarkers );
            
            return olMap;
        },
        
        _deploySelectFeatureControl: function( layers ) {
            var instance = this;
            
            // register callback event, will add the layers later
            var selectControl = new OpenLayers.Control.SelectFeature( 
                layers,
                {
                    clickout: true,
                    toggle: true,
                    multiple: false,
                    onSelect: function( event ) {
                        // check if point is in selected points, if so, return
                        if ( instance.selectedPoints[event.attributes.id] ) {
                            return;
                        }
                        
                        var point = instance.pointHash[event.layer.id][event.attributes.id];
                                                
                        instance.selectPoint( event.layer.id, event.attributes.id);

                        // trigger unselect immediately so that this function works more like an onClick()
                        selectControl.unselect( event );

                        if ( instance.options.selectCallback !== null && typeof instance.options.selectCallback === 'function' ) {
                            instance.options.selectCallback( $.extend( {}, point ) );
                        }
                    }
                }
            );
    
            this.map.addControl( selectControl );
            selectControl.activate();
            
            return selectControl;
        },
        
        // data helpers
        _addSelectLayer: function( ) {
            // remove selected layer if exists
            var getLayer = this.map.getLayer( SELECTED_LAYER_NAME );
            if ( getLayer ) {
                this.map.removeLayer( getLayer );
            }
            
            // TODO generalize
            var ml = new MapliteDataSource(
                null,
                'Selected Stations',
                SELECTED_LAYER_NAME,
                this.options.selectedColor,
                'EPSG:4326'
            );
    
            var layer = this._translateJSON( ml, this.selectedPoints, this.map.getProjectionObject() );
            this.map.addLayer( layer );
            
            this.selectLayer = layer;
            
            this.map.raiseLayer( layer, this.map.layers.length - 1 );
            this.map.resetLayersZIndex();
            
            // re-register select listener
            var selectFeatures = [];
            var instance = this;

            $.each( this.layers.maplite, function() {
                selectFeatures.push( instance._getCacheLayer( this, instance.map.getZoom() ) );
            });
            
            selectFeatures.push(layer);
            
            this.selectControl.setLayer( selectFeatures );
        },
        
        _translateJSON: function( mapliteLayer, points, mapProjection ) {
            var pointsLayer = new OpenLayers.Layer.Vector(
                mapliteLayer.name,
                {
                    projection: mapProjection, 
                    units: UNITS,
                    styleMap: this._setDefaultStyleMap( mapliteLayer ),
                    displayInLayerSwitcher: false
                }
            );

            pointsLayer.id = mapliteLayer.id;
    
            var features = [];

            $.each( points, function( i, obj ) {
                var coordinates = new OpenLayers.LonLat( obj.lon, obj.lat );

                if ( mapliteLayer.projection !== mapProjection ) {
                    coordinates = coordinates.transform(
                        mapliteLayer.projection,
                        mapProjection
                    );
                }

                var point = new OpenLayers.Geometry.Point( coordinates.lon, coordinates.lat );
                var pointFeature = new OpenLayers.Feature.Vector(point);
                
                // store attributes for later use in calling app
                pointFeature.attributes.label = "";
                for (var key in obj) {
                    pointFeature.attributes[key] = obj[key];
                }
                pointFeature.attributes.layerDefinition = mapliteLayer;
                
                features.push( pointFeature );    
            });

            pointsLayer.addFeatures( features );

            return pointsLayer;
        },
        
        _hashPoints: function( points ) {
            var hash = {};
            $.each( points, function( i, point ){
                hash[point.id] = point;
                hash[point.id].selected = false;
                hash[point.id].label = "";
            });
            
            return hash;
        },
        
        // zoom handlers
        
        _scaleMapliteMarkers: function() {
            var zoom = this.map.getZoom();
            var selectFeatures = [];
            var instance = this;

            $.each( this.layers.maplite, function() {
                var toAdd = false;
                
                // remove corresponding layer if exists
                var getLayer = instance.map.getLayer( this.id );
                if ( getLayer ) { // exists and is visible
                    if ( getLayer.visibility ) {
                        instance.map.removeLayer( getLayer );
                        toAdd = true;
                    }
                } else {
                    toAdd = true;
                }
                
                if ( toAdd ) {
                    var cacheLayer = instance._getCacheLayer( this, zoom );
                    selectFeatures.push( cacheLayer );
                }
            });
            //debugger;
            this.map.addLayers( selectFeatures );
            
            if ( this.selectLayer ) {
                selectFeatures.push( this.selectLayer );
                this.map.raiseLayer( this.selectLayer, this.map.layers.length - 1 );
                this.map.resetLayersZIndex();
            }
            
            if ( this.selectControl === null ) {
                this.selectControl = this._deploySelectFeatureControl( selectFeatures );
            } else {
                this.selectControl.setLayer( selectFeatures );
            }
        },
        
        _buildFilterFunctionCache: function( filter, layer ) {
            var cache = {};
            return function( zoom ) {
                if ( cache[zoom] !== undefined ) {
                    return cache[zoom];
                }
                
                cache[zoom] = filter( zoom, layer );
                return cache[zoom];
            };
        },
        
        _getCacheLayer: function( layer, zoom ) {
            var points = this.filters[layer.id](zoom);

            if ( typeof this.mapliteLayerCache[layer.id] === 'undefined' || this.mapliteLayerCache[layer.id] === null ) {
                this.mapliteLayerCache[layer.id] = {};
            }

            if (typeof this.mapliteLayerCache[layer.id][zoom] === 'undefined' || this.mapliteLayerCache[layer.id][zoom] === null) {
                this.mapliteLayerCache[layer.id][zoom] = this._translateJSON( layer, points, this.map.getProjectionObject() );
            }

            return this.mapliteLayerCache[layer.id][zoom];
        },
        
        // layer generation, marker styling
        
        _setDefaultStyleMap: function( mapliteLayer ) {
            var styleMap = mapliteLayer.styleMap;
            // provide default label style if not provided
            if (typeof styleMap !== 'undefined' && styleMap instanceof OpenLayers.StyleMap ) {
                return styleMap;
            } else {
                var cursor = '';
                if ( this.options.selectCallback !== null && typeof this.options.selectCallback === 'function' ) {
                    cursor = 'pointer';
                }
                
                return new OpenLayers.StyleMap({
                    "default": new OpenLayers.Style(OpenLayers.Util.applyDefaults({
                        externalGraphic: this._findIconPath( mapliteLayer.color ),
                        fillOpacity: 1,
                        pointRadius: 12,
                        label: '${label}',
                        labelXOffset: 10,
                        labelYOffset: 16,
                        cursor: cursor
                    }, OpenLayers.Feature.Vector.style["default"])),
                    "select": new OpenLayers.Style(OpenLayers.Util.applyDefaults({
                        externalGraphic: this._findIconPath( mapliteLayer.color ),
                        fillOpacity: 1,
                        pointRadius: 12,
                        label: '${label}',
                        labelXOffset: 10,
                        labelYOffset: 16,
                        cursor: cursor
                    }, OpenLayers.Feature.Vector.style["select"]))
                });
            }
        },

        _findIconPath: function( marker ) {
            // translate to object, if string
            if ( typeof marker === 'string' ) {
                marker = marker.toUpperCase();
                marker = MARKER_COLORS[marker];
            }
            
            // provide default if marker isn't valid
            if ( typeof marker === 'undefined' 
                    || typeof marker.hex === 'undefined' || marker.hex === null) {
                marker = MARKER_COLORS.RED;
            }
            
            return this.options.iconPath + marker.hex.substring(1) + ICON_EXTENSION;
        },
        
        // layer selector
        
        _deploySelector: function() {
            var baseId = this.element[0].id;
            
            $('<div/>', {
                id: baseId + '',
                class: 'selectPane'
            }).appendTo('#' + baseId);
        },
        
        _addOverlay: function( id ) {
            if ( this.map.getLayer( id ) === null ) {
                this.map.addLayer( this.layers.overlays[id] );
            }
        },
        
        //----------------------------------------------------------------------
        // Public methods
        //----------------------------------------------------------------------
        zoomToMaxExtent: function() {
            this.map.zoomToMaxExtent();
        },

        // $(...).mapLite('setCenterAndZoom', o):
        //   o should be a JS object with two properties:
        //      (Array) o.center = 2-element JS array of numbers: x,y coords of map center
        //      (Number) o.zoom = map zoom level
        setCenterAndZoom: function(o) {
            this.map.setCenter(o.center, o.zoom);
        },

        // $(...).mapLite('getCenterAndZoom'):
        //    returns an object of the format described above for setCenterAndZoom(), giving the map's
        //    current center and zoom level
        getCenterAndZoom: function() {
            var zoom = this.map.getZoom();
            var center = this.map.getCenter();
            return {
                center : [center.lon, center.lat],
                zoom   : zoom
            };
        },

        redrawLayer: function(layerId) {
            var layer = this.map.getLayer( layerId );
            if (!layer || layer === null) { return null; }
            //NOTE: not sure why, but layer.refresh() doesn't seem to do the trick here
            //layer.refresh({force:true});
            //NOTE: layer.redraw() does, though!
            layer.redraw();
        },
        
        setBaseLayer: function( layerId ) {
            var layer = this.map.getLayer( layerId );
            
            if ( layer && layer.isBaseLayer ) {
                this.map.setBaseLayer( layer );
                $( '#mlBaseList', '#mlLayerList').val( layerId );
            }
        },
        
        /*
         * $(...).mapLite('setLayerVisibility', 'layerId', false);
         */
        setLayerVisibility: function( layerId, visible ) {
            var toScale = false;
            
            if (visible) {
                this._addOverlay( layerId );
                
                // check if makers toggled to visible, the markers aren't being scaled when invisible
                // so scale if they go from invisible to visible
                toScale = this.layers.maplite.some( function( lyr ) {
                    return lyr.id === layerId;
                });
            }
            var layer = this.map.getLayer( layerId );
            if (!layer || layer === null) { return null; }
            
            layer.setVisibility( visible );
            
            if ( toScale ) {
                this._scaleMapliteMarkers();
            }
            
            $( '#chk_' + layerId ).prop( 'checked', visible);
        },
        
        setLayerOpacity: function( layerId, opacity ) {
            var layer = this.map.getLayer( layerId );
            if (!layer || layer === null) { return null; }
            
            layer.setOpacity( opacity );
        },
        
        getLayerOpacity: function( layerId ) {
            var layer = this.map.getLayer( layerId );
            if (!layer || layer === null) { return null; }
            
            return layer.opacity;
        },

        getPoint: function(layerId, id) {
           return $.extend( {}, this.pointHash[layerId][id] );
        },
        
        selectPoint: function( layerId, id ) {
            if ( this.selectedPoints[id] ) {
                return;
            }
            
            // deep copy so that labels don't appear in the core point hash
            var point = $.extend( {}, this.pointHash[layerId][id]);
            
            var size = 1;
            
            $.each(this.selectedPoints, function() {
               size++; 
            });
                        
            point.label = size;
            
            this.selectedPoints[id] = point;
                        
            this._addSelectLayer();
            
            return $.extend( {}, point );
        },
        
        unselectPoint: function( id ) {
            delete this.selectedPoints[id];
            this._addSelectLayer();
        },
        
        setLabel: function( id, label ) {
            this.selectedPoints[id].label = label;
            this._addSelectLayer();
        }
    });
    
    // map configuration utils
    function MapConfig( config ) {
        var deferred = $.Deferred();
        
        // perform translations
        var translatedConfig = translateMapConfig( config );
        
        // check if any async calls need to be resolved before sending back
        if ( translatedConfig.async.requests.length > 0 ) {
            $.when.apply( $, translatedConfig.async.requests ).then( function() {
                // merge the async responses
                $.extend( translatedConfig.layers.bases, translatedConfig.async.layers.bases );
                $.extend( translatedConfig.mapOptions, translatedConfig.async.mapOptions );
                deferred.resolve( translatedConfig.options, translatedConfig.mapOptions, translatedConfig.layers );
            }, function() { 
                // one has a failure
                deferred.reject();
            });
        } else {
            deferred.resolve( translatedConfig.options, translatedConfig.mapOptions, translatedConfig.layers );
        }
        
        return deferred.promise();
    };
    
    function translateMapConfig( rawJson ) {
        var config = {
            options: {},
            mapOptions: {},
            layers: {
                bases: [],
                overlays: {},
                groups: []
            },
            async: {
                requests: [],
                options: {},
                mapOptions: {},
                layers: {
                    bases: []
                }
            }
        };
        
        // baselayer
        if ( rawJson.hasOwnProperty( 'bases' ) ) {
            rawJson.bases.forEach( function( layer ) {
                translateBaseLayer( layer, config );
            });
        }
        
        if ( rawJson.hasOwnProperty( 'overlays' ) ) {
            $.each( rawJson.overlays, function(){
                
                if ( !this.hasOwnProperty( 'type' ) || this.type === 'WMS' ) {
                    config.layers.overlays[this.id] = translateWms( this );
                } else if ( this.type === 'REST' ) {
                    config.layers.overlays[this.id] = translateRest( this );
                }
                
                
            });
        }
        
        if ( rawJson.hasOwnProperty( 'groups' ) ) {
            config.layers.groups = rawJson.groups;
        }
        
        return config;
    }
    
    function translateBaseLayer( base, config ) {
        switch( base.type ) {
            case 'arcgis':
                config.async.requests.push($.ajax({
                    url: base.url + '?f=json&pretty=true',
                    dataType: "jsonp",
                    success: function ( info ) {
                        var bLyr = new OpenLayers.Layer.ArcGISCache( base.name, base.url, {
                            layerInfo: info
                        });
                        
                        bLyr.id = base.id;
                        bLyr.isDefault = base.isDefault;
                        
                        config.async.layers.bases.push( bLyr );
                        
                        config.async.mapOptions.resolutions = bLyr.resolutions;
                    }
                }));
                
                break;
            default :
                var bLyr = new OpenLayers.Layer.XYZ(
                        'OSM (with buffer)',
                [
                    'http://a.tile.openstreetmap.org/${z}/${x}/${y}.png',
                    'http://b.tile.openstreetmap.org/${z}/${x}/${y}.png',
                    'http://c.tile.openstreetmap.org/${z}/${x}/${y}.png'
                ], {
                    transitionEffect: 'resize',
                    buffer: 2,
                    sphericalMercator: true });
                
                bLyr.id = base.id;
                
                config.layers.bases.push( bLyr );
                break;
        }
    }
    
    
    function translateWms( wms ) {
        var wmsProps = { 
            layers: wms.layers, 
            transparent: true
        };
        
        var layer = new OpenLayers.Layer.WMS( wms.name, wms.url, wmsProps);
        
        if ( wms.hasOwnProperty('projection')) {
            layer.projection = wms.projection;
        };
        
        layer.id = wms.id;
        layer.isBaseLayer = false;

        return layer;
    }
    
    function translateRest( rest ) {
        var layers = 'show:';
        if ( typeof rest.layers === 'string') {
            layers += rest.layers;
        } else if ( rest.layers instanceof Array ) {
            layers += rest.layers.join( ',' );
        }
                
        var restProps = {
            layers: layers,
            transparent: true
        };
        
        var layer = new OpenLayers.Layer.ArcGIS93Rest( rest.name, rest.url, restProps);
        
        if ( rest.hasOwnProperty( 'projection' )) {
            layer.projection = rest.projection;
        }
        
        layer.id = rest.id;
        layer.isBaseLayer = false;
        
        return layer;
    }
    
    // global namespace exports
    
    $.nemac.MARKER_COLORS = MARKER_COLORS;
    $.nemac.MapliteDataSource = MapliteDataSource;
    
})(jQuery, document);
