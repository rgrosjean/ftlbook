// Run before `npm publish`: the package is internal and must never go to the public npm registry.
// Publish with `npm publish --registry <your registry>`, or set the registry in your ~/.npmrc.
const registry = process.env.npm_config_registry ?? "";
if (registry === "" || /^https?:\/\/registry\.npmjs\.org\/?$/.test(registry)) {
  console.error(`Refusing to publish to ${registry || "the default registry"}: pass --registry <your private registry>.`);
  process.exit(1);
}
console.log(`Publishing to ${registry}`);
