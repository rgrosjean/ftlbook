<#macro registrationLayout params...>
<!DOCTYPE html>
<html lang="${lang}">
<head><title>${title!}</title></head>
<body>
<div id="acme-layout">
    <header><#nested "header"></header>
    <main><#nested "form"></main>
</div>
</body>
</html>
</#macro>
