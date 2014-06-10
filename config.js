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
            config.layers.overlays[this.id] = translateWms( this );
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
    
    var layer = new OpenLayers.Layer.WMS(
        wms.name,
        wms.url,
        wmsProps);

    if ( wms.hasOwnProperty('projection')) {
        layer.projection = wms.projection;
    };
    
    layer.id = wms.id;
    layer.isBaseLayer = false;
    
    return layer;
}