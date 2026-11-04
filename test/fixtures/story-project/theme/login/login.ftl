<#-- Probe Page: prints parts of the merged Mock model so tests can observe Story merging -->
<#import "template.ftl" as layout>
<@layout.registrationLayout; section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <ul id="probe">
            <li id="realm-name">${realm.name}</li>
            <li id="registration-allowed">${realm.registrationAllowed?c}</li>
            <li id="providers"><#list (social.providers)![] as p>[${p.alias}]</#list></li>
            <li id="social"><#if social??>present<#else>absent</#if></li>
        </ul>
    </#if>
</@layout.registrationLayout>
