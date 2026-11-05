<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=false; section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <form id="acme-base-login" action="${url.loginAction}" method="post">
            <p>${msg("acmeBaseGreeting")}</p>
        </form>
    </#if>
</@layout.registrationLayout>
