function createFeature(host, Feature, { key, legacyId, label }) {
  const feature = new Feature();
  feature.app = host.app;
  feature.manifest = {
    ...host.manifest,
    id: `${host.manifest.id}-${key}`,
    name: `Learning Hub · ${label}`,
  };
  feature.loadData = () => host.loadIntegratedData(key, legacyId);
  feature.saveData = value => host.saveIntegratedData(key, value);
  feature.settingsHost = host;
  feature.getSharedDeepSeekSettings = () => host.state?.deepseek || {};
  feature.adoptSharedDeepSeekApiKey = async legacyKey => {
    const keyValue = String(legacyKey || '').trim();
    const shared = host.state?.deepseek;
    if (keyValue && shared && !String(shared.apiKey || '').trim()) {
      shared.apiKey = keyValue;
      await host.saveData(host.state);
    }
    return String(shared?.apiKey || '').trim();
  };

  for (const method of [
    'register', 'registerEvent', 'registerDomEvent', 'registerInterval',
    'registerView', 'registerMarkdownPostProcessor', 'registerEditorExtension',
    'registerHoverLinkSource', 'addRibbonIcon', 'addStatusBarItem',
  ]) {
    if (typeof host[method] === 'function') feature[method] = host[method].bind(host);
  }
  host.integratedSettingTabs ||= [];
  feature.addSettingTab = tab => host.integratedSettingTabs.push({ key, label, tab });
  if (typeof host.addCommand === 'function') {
    feature.addCommand = command => host.addCommand({
      ...command,
      id: `${key}-${command.id}`,
    });
  }
  return feature;
}

module.exports = { createFeature };
