# lakey playground

free static website in azure with nodejs function apis, ssl certs, custom domain names, etc.  
* youtube channel carousel with cache
* juicer.io free tier brings in 2 social feeds
* deploys with 2 azure-cli commands for SSL, Custom Domains, and storage
* website updates auto-deploy with every push to ```main``` branch



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

