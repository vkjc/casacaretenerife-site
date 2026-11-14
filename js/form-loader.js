class FormLoader {
  constructor(containerId = 'form-root') {
    this.container = document.getElementById(containerId);
    this.cookieName = 'cc_ab_variant';
    this.cookieDays = 30;
  }

  async init() {
    const savedVariant = this.getCookie(this.cookieName);
    if (savedVariant) {
      await this.loadVariant(savedVariant);
      return;
    }

    try {
      const response = await fetch('/api/ab-config');
      const config = await response.json();
      const variants = config.variants || [];

      const active = variants.filter(v => v.is_active === 1 || v.is_active === true);
      if (active.length === 0) {
        console.error('Нет активных вариантов форм');
        return;
      }

      const selected = this.weightedChoice(active);
      this.setCookie(this.cookieName, selected.variant_id, this.cookieDays);
      await this.loadVariant(selected.variant_id, selected.form_module);
    } catch (e) {
      console.error('Ошибка загрузки конфига A/B:', e);
      await this.loadVariant('variant-a', 'js/forms/variant-a.js');
    }
  }

  weightedChoice(variants) {
    const total = variants.reduce((sum, v) => sum + (parseInt(v.traffic_percent) || 0), 0);
    let random = Math.random() * total;
    for (const v of variants) {
      const weight = parseInt(v.traffic_percent) || 0;
      if (random < weight) return v;
      random -= weight;
    }
    return variants[variants.length - 1];
  }

  async loadVariant(variantId, modulePath) {
    try {
      const mod = await import(modulePath);
      if (mod && typeof mod.init === 'function') {
        mod.init(this.container);
      } else {
        console.error(`Модуль ${modulePath} не экспортирует функцию init`);
      }
    } catch (e) {
      console.error(`Ошибка загрузки модуля формы ${modulePath}:`, e);
    }
  }

  getCookie(name) {
    const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    return match ? match[2] : null;
  }

  setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = `${name}=${value}; Path=/; Expires=${expires}; SameSite=Lax`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const loader = new FormLoader();
  loader.init();
});