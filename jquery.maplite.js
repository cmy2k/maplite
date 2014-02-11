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
 *   $( DIV_SELECTOR ).mapLite( "myMethodName", ARG1, ARG2, ... );
 * 
 * Command methods (return this for chaining)
 * 
 * Getters (return the requested value)
 * 
 * ------- NOTES -------
 * projection: EPSG:900913
 * untis: m
 * 
 */

function MapliteDataSource( url, name, pointStyle ) {
    this.url = url;
    this.name = name;
    this.pointStyle = pointStyle;
}

(function($){
    // statics
    var size = new OpenLayers.Size(14,24);
    var offset = new OpenLayers.Pixel(-(size.w)/2, -size.h);
    var defaultIconPath = 'static/icons/markers/24/fb6254.png';
    var defaultMarker = new OpenLayers.Icon(defaultIconPath, size, offset);


    $.widget( "nemac.mapLite", {
        //
        // Defaults
        //
        options: {
            baseLayer: new OpenLayers.Layer.XYZ(
                    "OSM (with buffer)",
                    [
                        "http://a.tile.openstreetmap.org/${z}/${x}/${y}.png",
                        "http://b.tile.openstreetmap.org/${z}/${x}/${y}.png",
                        "http://c.tile.openstreetmap.org/${z}/${x}/${y}.png"
                    ], {
                        transitionEffect: "resize",
                        buffer: 2,
                        sphericalMercator: true
                    }),
            layers: [],
            extent: new OpenLayers.Bounds(
                -15000000, 2000000, -6000000, 7000000
            )
        },
        
        //
        // Private methods
        //
        _create: function() {
            // add the isBaseLayer property to the specified base layer, if not added
            var baseLayer = $.extend( {}, this.options.baseLayer, { isBaseLayer: true });
            // push the base layer into the layers array for cleaner initialization
            var layers = $.merge( [], this.options.layers );
            layers.push( baseLayer );
            
            var deferredLayers;
            
            // separate mapLite layers from passthrough layers
            $.each( layers, function( index, value ) {
                if ( value instanceof MapliteDataSource ) {
                    deferredLayers.push( value );
                    layers.splice( index, 1 );
                }
            });
            
            this.map = this._initMap();
            map.zoomToExtent( this.options.extent, true );
            
            var instance = this;
            $.each( deferredLayers, function( index, value ) {
                instance._addMapliteData( value, instance.map );
            });
        },
        
        _initMap: function() {
            return new OpenLayers.Map({
                div: this.element[0],
                extent: this.options.extent,
                units: "m",
                layers: layers,
                controls: [
                    new OpenLayers.Control.Navigation({
                        dragPanOptions: {
                            enableKinetic: true
                        }
                    })
                ],
                zoom: 4,
                projection: new OpenLayers.Projection( "EPSG:900913" )
            });
        },
        
        _addMapliteData: function( layer, map ) {
            var instance = this;
            $.getJSON( layer.url, function( data ) {
                map.addLayer( instance._translateJSON( layer, data ) );
            });
        },
        
        _translateJSON: function( layer, data ) {
            var pointsLayer = new OpenLayers.Layer.Markers(
                    layer.name,
                    {
                        projection  : new OpenLayers.Projection("EPSG:900913"), 
                        units       : "m"
                    }
            );
            
        }
    });

})(jQuery);