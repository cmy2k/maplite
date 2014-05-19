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
                $.extend( translatedConfig.options, translatedConfig.async.options );
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
    var config = { options: {}, mapOptions: {}, layers: [], async: { requests: [], options: {}, mapOptions: {} } };

    // baselayer
    if ( rawJson.hasOwnProperty( 'baseLayers' ) ) {
        // TODO in the future support multiple base layers
        translateBaseLayer( rawJson.baseLayers[0], config );        
    } 
    
    if ( rawJson.hasOwnProperty( 'wms' ) ) {
        $.each( rawJson.wms, function(){
            config.layers.push( translateWms( this ) );
        });
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
                    config.async.options.baseLayer = new OpenLayers.Layer.ArcGISCache( base.name, base.url, {
                        layerInfo: info,
                        displayInLayerSwitcher: base.toggle
                    });
                    
                    config.async.mapOptions.resolutions = config.async.options.baseLayer.resolutions;
                }
            }));
            
            break;
        default :
            config.options.baseLayer = new OpenLayers.Layer.XYZ(
                'OSM (with buffer)',
                [
                    'http://a.tile.openstreetmap.org/${z}/${x}/${y}.png',
                    'http://b.tile.openstreetmap.org/${z}/${x}/${y}.png',
                    'http://c.tile.openstreetmap.org/${z}/${x}/${y}.png'
                ], {
                    transitionEffect: 'resize',
                    buffer: 2,
                    sphericalMercator: true
                });
            break;
    }
}

    
function translateWms( wms ) {
    return new OpenLayers.Layer.WMS(
        wms.name,
        wms.url,
        {layers: wms.layers, transparent: true});
}