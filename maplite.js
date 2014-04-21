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

var MARKER_COLORS = {
    RED: {hex: '#fb6254'},
    GREEN: {hex: '#00e03c'},
    BLUE: {hex: '#4462c8'},
    CYAN: {hex: '#54d6d6'},
    PURPLE: {hex: '#7d54fb'},
    YELLOW: {hex: '#fcf357'}
};

function MapliteDataSource( url, name, id, color, projection, styleMap, zoomFilter ) {
    this.url = url;
    this.name = name;
    this.id = id;
    this.color = color;
    this.projection = projection;
    this.styleMap = styleMap;
    this.zoomFilter = zoomFilter;
}

(function($, document){
    // private constants
    var ICON_PATH = 'markers/24/';
    var ICON_EXTENSION = '.png';
    var UNITS = 'm';
    var PROJECTION = 'EPSG:900913';

    $.widget( 'nemac.mapLite', {
        //
        // Defaults
        //
        options: {
            baseLayer: new OpenLayers.Layer.XYZ(
                'OSM (with buffer)',
                [
                    'http://a.tile.openstreetmap.org/${z}/${x}/${y}.png',
                    'http://b.tile.openstreetmap.org/${z}/${x}/${y}.png',
                    'http://c.tile.openstreetmap.org/${z}/${x}/${y}.png'
                ], {
                    transitionEffect: 'resize',
                    buffer: 2,
                    sphericalMercator: true
                }),
            layers: [],
            mapOptions: {},
            iconPath: ICON_PATH,
            zoomCallback: null,
            moveCallback: null,
            // for a priority, a marker will be displayed for the zoom defined or higher
            // zoomPriorities[pointPriority] = minimumZoomLevelItShouldBeDisplayedAt
            zoomPriorities: [],
            priorityDataKey: 'weight',
            selectCallback: null
        },
        
        //
        // Private vars
        //
        layers: [],
        map: null,
        selectControl: null,
        filters: [],
        
        //
        // Private methods
        //
        _create: function() {
            // prepare layers
            this.layers = this._mergeBaseLayerWithLayers( this.options.baseLayer, this.options.layers );
            var mapLayers = this._separateLayersByType( this.layers );

            // init map
            this.map = this._initMap( mapLayers.passthrough );

            // add deferred layers
            var deferredLayers = [];
            var instance = this;
            
            var requests = [];
            
            $.each( mapLayers.maplight, function( i, mapliteLayer ) {
                requests.push(
                    $.get( mapliteLayer.url )
                    .success( function( points ){
                        deferredLayers.push(
                            instance._translateJSON( mapliteLayer, points, instance.map.getProjectionObject() ) 
                        );
                    })
                );
            });
            
            $.when.apply( $, requests ).done( function() {
                instance.map.addLayers( deferredLayers );
                
                instance.selectControl = instance._deploySelectFeatureControl( deferredLayers );

                // set initial visibility
                if ( Array.isArray( instance.options.zoomPriorities ) && instance.options.zoomPriorities.length > 0 ) {
                    instance._scaleMapliteMarkers();
                }

                if (instance.options.onCreate !== null && typeof instance.options.onCreate === 'function' ) {
                    instance.options.onCreate(instance);
                }
            });
        },
        
        _mergeBaseLayerWithLayers: function( base, layers ) {
            // add the isBaseLayer property to the specified base layer, if not added
            var baseLayer = $.extend( {}, base, { isBaseLayer: true });
            
            // push the base layer into the layers array for cleaner initialization
            var mergedLayers = $.merge( [], layers );
            mergedLayers.push( baseLayer );
            
            return mergedLayers;
        },
        
        _separateLayersByType: function( layers ) {
            var passthroughLayers = [];
            var maplightLayers = [];

            // separate mapLite layers from passthrough layers
            $.each( layers, function( i, value ) {
                if ( value instanceof MapliteDataSource ) {
                    maplightLayers.push( value );
                } else {
                    passthroughLayers.push( value );
                }
            });
            
            return {
                maplight: maplightLayers,
                passthrough: passthroughLayers
            };
        },
        
        _initMap: function( initialLayers ) {
            var mapBaseOptions = {
                div: this.element[0],
                //extent: this.options.extent,
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
            
            if ( Array.isArray( this.options.zoomPriorities ) && this.options.zoomPriorities.length > 0 ) {
                olMap.events.register("zoomend", this, this._scaleMapliteMarkers);
            }
            
            return olMap;
        },
        
        _deploySelectFeatureControl: function( initialLayers ) {
            var instance = this;
            
            // register callbacks
            var selectControl = new OpenLayers.Control.SelectFeature( 
                initialLayers,
                {
                    clickout: true,
                    toggle: true,
                    multiple: false,
                    onSelect: function( event ) {
                        if ( instance.options.selectCallback !== null && typeof instance.options.selectCallback === 'function' ) {
                            instance.options.selectCallback( event );
                            event.layer.redraw();
                            // trigger unselect immediately so that this function works more like an onClick()
                            selectControl.unselect( event );
                        }
                    }
                }
            );
    
            this.map.addControl( selectControl );
            selectControl.activate();
            
            return selectControl;
        },
        
        _translateJSON: function( mapliteLayer, points, mapProjection ) {
            var pointsLayer = new OpenLayers.Layer.Vector(
                mapliteLayer.name,
                {
                    projection: mapProjection, 
                    units: UNITS,
                    styleMap: this._setDefaultStyleMap( mapliteLayer )
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

        _scaleMapliteMarkers: function() {
            var zoom = this.map.getZoom();
            var layers = this._separateLayersByType( this.layers ).maplight;
            
            var instance = this;
            var points = [];
            $.each( layers, function( i, layer ){
                points = points.concat( instance.map.getLayer( layer.id ).features );
            });
                                    
            $.each( points, function( i, point ){
                var pt = document.getElementById( point.geometry.id );
                if ( pt !== null ) {
                    var visible = instance._isVisible( point.attributes[instance.options.priorityDataKey], zoom ) || point.attributes.selected;
                    if (visible) {
                        pt.setAttribute( 'visibility', 'visible' );
                    } else {
                        pt.setAttribute( 'visibility', 'hidden' );
                    }
                }
            });
            
        },

        _isVisible: function( priority, zoom ) {
            return this.options.zoomPriorities[priority] <= zoom;
        },
        
        _memoizeLayerFilter: function( filter, layer ) {
            var memo = {};
            return function( zoom ) {
                if ( memo[zoom] !== undefined ) {
                    return memo[zoom];
                }
                
                memo[zoom] = filter( zoom, layer );
                return memo[zoom];
            };
        },
        
        //
        // Public methods
        //
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

        // $(...).mapLite('getMap'):
        //   return the underlying OpenLayers map object
        //   TODO: consider removing this, so clients can't program OL-specific behavior, allowing us to
        //   change to some other underlying map API (Leaflet?) in the future???
        getMap: function() {
            return this.map;
        },

        redrawLayer: function(layerId) {
            var layer = this.map.getLayer( layerId );
            if (!layer || layer === null) { return null; }
            //NOTE: not sure why, but layer.refresh() doesn't seem to do the trick here
            //layer.refresh({force:true});
            //NOTE: layer.redraw() does, though!
            layer.redraw();
        },

        getPoint: function(layerId, id) {
            var layer = this.map.getLayer( layerId );
            if (!layer || layer === null) { return null; }
            var features = layer.features;
            if (!features || features === null) { return null; }
            var i;
            for (i=0; i<features.length; ++i) {
                if (features[i].attributes.id === id) {
                    return features[i];
                }
            }
            return null;
        }


    });

})(jQuery, document);
