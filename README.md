# lakey playground

free static website in azure with nodejs function apis, ssl certs, custom domain names, etc.  
* youtube channel carousel with cache
* local social feed gallery powered by server-side api aggregation
* deploys with 2 azure-cli commands for SSL, Custom Domains, and storage
* website updates auto-deploy with every push to ```main``` branch

## api endpoints

* ```GET /api/getVideos``` returns normalized video items for a playlist
* ```GET /api/getSocials``` returns normalized social feed cards aggregated from one or more providers (youtube playlists and optional external json feed)

## environment variables

* ```YOUTUBE_API_KEY``` required for youtube data api requests
* ```STORAGE_CONNECTION_STRING``` required for azure blob cache storage
* ```DEFAULT_PLAYLIST_ID``` optional default playlist id for video feed
* ```SOCIAL_YOUTUBE_PLAYLISTS``` optional comma-separated playlist ids used by social feed; falls back to ```DEFAULT_PLAYLIST_ID```
* ```SOCIAL_JSON_FEED_URL``` optional URL to a JSON feed (array or { items: [] }) that is merged into social cards

## notes

* ```getVideos``` supports pagination with ```pageToken``` and request size via ```maxResults```
* both endpoints support cache bypass with ```refresh=true```
* video cache ttl is 24h; social cache ttl is 2h
* frontend now includes loading skeletons and retry controls for both videos and socials

## smoke tests

from the api directory:
```
npm run smoke:test
```

you can override the api host with:
```
BASE_URL="https://<your-site>/api" npm run smoke:test
```


***remember to az login first***
```
    az staticwebapp create \
        --name "$NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --source "$SOURCE" \
        --branch "main" \
        --location "centralus" \
        --app-location "/" \
        --login-with-github
```

add the domain
```
    az staticwebapp hostname set --name "$NAME" --resource-group "$RESOURCE_GROUP" --hostname "$DOMAIN_NAME"
```

