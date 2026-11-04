<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=false; section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <form id="acme-login" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">
            <p>ACME custom login page</p>
            <button type="submit">${msg("doLogIn")}</button>
        </form>
    </#if>
</@layout.registrationLayout>
