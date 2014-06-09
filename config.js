// map configuration utils
function MapConfig( configurationUri ) {
    var deferred = $.Deferred();

    $.getJSON( configurationUri ).done( function( data ){
        // perform translations
        var translatedConfig = translateMapConfig( data );
        
        // check if any async calls need to be resolved before sending back
        if ( translatedConfig.async.requests.length > 0 ) {
            $.when.apply( $, translatedConfig.async.requests ).then( function() {
                // merge the async responses
                $.extend( translatedConfig.layers.base, translatedConfig.async.layers.base );
                $.extend( translatedConfig.mapOptions, translatedConfig.async.mapOptions );
                deferred.resolve( translatedConfig.options, translatedConfig.mapOptions, translatedConfig.layers );
            }, function() { 
                // one has a failure
                deferred.reject();
            });
        } else {
            deferred.resolve( translatedConfig.options, translatedConfig.mapOptions, translatedConfig.layers );
        }
    }).fail( function() {
        deferred.reject();
    });

    return deferred.promise();
};

function translateMapConfig( rawJson ) {
    var config = {
        options: {},
        mapOptions: {},
        layers: {
            base: [],
            overlays: [],
            themes: []
        },
        async: {
            requests: [],
            options: {},
            mapOptions: {},
            layers: {
                base: []
            }
        }
    };

    // baselayer
    if ( rawJson.hasOwnProperty( 'baseLayers' ) ) {
        // TODO in the future support multiple base layers
        rawJson.baseLayers.forEach( function( layer ) {
            translateBaseLayer( layer, config );
        });
    }
    
    if ( rawJson.hasOwnProperty( 'overlays' ) ) {
        $.each( rawJson.overlays, function(){
            config.layers.overlays.push( translateWms( this ) );
        });
    }
    
    if ( rawJson.hasOwnProperty( 'themes' ) ) {
        
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
                    
                    config.async.layers.base.push( bLyr );
                    
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
            
            config.options.baseLayers = [ bLyr ];
            break;
    }
}

    
function translateWms( wms ) {
    var wmsProps = { 
        layers: wms.layers, 
        transparent: true
    };
    
    var layer = new OpenLayers.Layer.WMS(
        wms.name,
        wms.url,
        wmsProps);

    if ( wms.hasOwnProperty('projection')) {
        layer.projection = wms.projection;
    };
    
    layer.id = wms.id;
    
    return layer;
}