const VARIANT_B_ID = 'variant-b';

const TEXTS = {
  ru: {
    step1: 'Регистрация через соцсеть',
    step2: 'Объект и услуги',
    step3: 'Контакты',
    btnGoogle: 'Продолжить с Google',
    btnFacebook: 'Продолжить с Facebook',
    btnWhatsApp: 'WhatsApp',
    btnTelegram: 'Telegram',
    btnViber: 'Viber',
    btnManual: 'Ввести вручную',
    placeName: 'Имя',
    placeEmail: 'Email',
    placePhone: 'Телефон',
    placeTown: 'Город / зона',
    btnPrev: 'Назад',
    btnNext: 'Далее',
    btnSend: 'Отправить заявку',
    sending: 'Отправка...',
    success: 'Заявка отправлена! Мы с вами свяжемся.',
    error: 'Ошибка отправки. Попробуйте ещё раз.',
    oauthSuccess: 'Аккаунт подключён. Данные подставлены автоматически.'
  },
  en: {
    step1: 'Register via social',
    step2: 'Property & services',
    step3: 'Contacts',
    btnGoogle: 'Continue with Google',
    btnFacebook: 'Continue with Facebook',
    btnWhatsApp: 'WhatsApp',
    btnTelegram: 'Telegram',
    btnViber: 'Viber',
    btnManual: 'Enter manually',
    placeName: 'Name',
    placeEmail: 'Email',
    placePhone: 'Phone',
    placeTown: 'City / zone',
    btnPrev: 'Back',
    btnNext: 'Next',
    btnSend: 'Submit request',
    sending: 'Sending...',
    success: 'Request submitted! We will contact you.',
    error: 'Submission error. Try again.',
    oauthSuccess: 'Account connected. Data filled automatically.'
  },
  es: {
    step1: 'Registro mediante red social',
    step2: 'Propiedad y servicios',
    step3: 'Contactos',
    btnGoogle: 'Continuar con Google',
    btnFacebook: 'Continuar con Facebook',
    btnWhatsApp: 'WhatsApp',
    btnTelegram: 'Telegram',
    btnViber: 'Viber',
    btnManual: 'Ingresar manualmente',
    placeName: 'Nombre',
    placeEmail: 'Email',
    placePhone: 'Teléfono',
    placeTown: 'Ciudad / zona',
    btnPrev: 'Atrás',
    btnNext: 'Siguiente',
    btnSend: 'Enviar solicitud',
    sending: 'Enviando...',
    success: 'Solicitud enviada. Nos pondremos en contacto.',
    error: 'Error al enviar. Inténtalo de nuevo.',
    oauthSuccess: 'Cuenta conectada. Los datos se rellenaron automáticamente.'
  },
  de: {
    step1: 'Registrierung über soziales Netzwerk',
    step2: 'Objekt & Dienstleistungen',
    step3: 'Kontakte',
    btnGoogle: 'Mit Google fortfahren',
    btnFacebook: 'Mit Facebook fortfahren',
    btnWhatsApp: 'WhatsApp',
    btnTelegram: 'Telegram',
    btnViber: 'Viber',
    btnManual: 'Manuell eingeben',
    placeName: 'Name',
    placeEmail: 'E-Mail',
    placePhone: 'Telefon',
    placeTown: 'Stadt / Zone',
    btnPrev: 'Zurück',
    btnNext: 'Weiter',
    btnSend: 'Anfrage absenden',
    sending: 'Wird gesendet...',
    success: 'Anfrage gesendet! Wir melden uns bei Ihnen.',
    error: 'Fehler beim Absenden. Noch einmal versuchen.',
    oauthSuccess: 'Konto verbunden. Daten wurden automatisch übernommen.'
  }
};

function getLang() {
  const m = window.location.pathname.match(/\/([a-z]{2})\//);
  return m ? m[1] : 'ru';
}

function t(key) {
  const lang = getLang();
  return (TEXTS[lang] || TEXTS.ru)[key] || key;
}

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function init(container) {
  container.innerHTML = '';
  container.className = 'ab-modal variant-b';

  const modal = document.createElement('div');
  modal.className = 'ab-modal-overlay';
  modal.innerHTML = `
    <div class="ab-modal-dialog">
      <button class="ab-modal-close" aria-label="Закрыть">×</button>
      <div class="ab-modal-body">
        <div class="ab-step ab-step-1" style="display:block;">
          <div class="ab-step-title">${t('step1')}</div>
          <div class="ab-social-grid">
            <button class="ab-btn ab-btn-google" data-provider="google">${t('btnGoogle')}</button>
            <button class="ab-btn ab-btn-facebook" data-provider="facebook">${t('btnFacebook')}</button>
            <button class="ab-btn ab-btn-whatsapp" data-provider="whatsapp">${t('btnWhatsApp')}</button>
            <button class="ab-btn ab-btn-telegram" data-provider="telegram">${t('btnTelegram')}</button>
            <button class="ab-btn ab-btn-viber" data-provider="viber">${t('btnViber')}</button>
            <button class="ab-btn ab-btn-manual" data-provider="manual">${t('btnManual')}</button>
          </div>
          <div class="ab-oauth-msg" style="margin-top:12px; font-size:12px; color:#666; display:none;"></div>
        </div>
        <div class="ab-step ab-step-2" style="display:none;">
          <div class="ab-step-title">${t('step2')}</div>
          <div class="ab-form-row">
            <label>${t('placeTown')}</label>
            <input type="text" id="vb-town" placeholder="${t('placeTown')}">
          </div>
          <div class="ab-form-row">
            <label>Тип объекта</label>
            <select id="vb-type">
              <option value="house">Дом</option>
              <option value="apartment">Квартира</option>
              <option value="land">Участок</option>
            </select>
          </div>
          <div class="ab-form-row">
            <label>Услуги</label>
            <div class="ab-checkboxes">
              <label><input type="checkbox" value="inspect"> Осмотр</label>
              <label><input type="checkbox" value="garden"> Сад</label>
              <label><input type="checkbox" value="pool"> Бассейн</label>
              <label><input type="checkbox" value="garage"> Гараж</label>
            </div>
          </div>
        </div>
        <div class="ab-step ab-step-3" style="display:none;">
          <div class="ab-step-title">${t('step3')}</div>
          <div class="ab-form-row">
            <label>${t('placeName')}</label>
            <input type="text" id="vb-name" placeholder="${t('placeName')}">
          </div>
          <div class="ab-form-row">
            <label>${t('placeEmail')}</label>
            <input type="email" id="vb-email" placeholder="${t('placeEmail')}">
          </div>
          <div class="ab-form-row">
            <label>${t('placePhone')}</label>
            <input type="tel" id="vb-phone" placeholder="${t('placePhone')}">
          </div>
          <div class="ab-form-row">
            <label>${t('placeTown')}</label>
            <input type="text" id="vb-town2" placeholder="${t('placeTown')}">
          </div>
        </div>
        <div class="ab-footer">
          <button class="ab-btn ab-btn-secondary ab-btn-prev" style="display:none;">${t('btnPrev')}</button>
          <button class="ab-btn ab-btn-primary ab-btn-next">${t('btnNext')}</button>
          <button class="ab-btn ab-btn-primary ab-btn-send" style="display:none;">${t('btnSend')}</button>
          <div class="ab-status" style="margin-top:10px; min-height:20px;"></div>
        </div>
      </div>
    </div>
  `;

  const overlay = modal.querySelector('.ab-modal-overlay');
  const closeBtn = modal.querySelector('.ab-modal-close');
  const step1 = modal.querySelector('.ab-step-1');
  const step2 = modal.querySelector('.ab-step-2');
  const step3 = modal.querySelector('.ab-step-3');
  const btnPrev = modal.querySelector('.ab-btn-prev');
  const btnNext = modal.querySelector('.ab-btn-next');
  const btnSend = modal.querySelector('.ab-btn-send');
  const status = modal.querySelector('.ab-status');

  let currentStep = 1;
  let socialProvider = null;
  let oauthData = null;

  function showStep(step) {
    currentStep = step;
    step1.style.display = step === 1 ? 'block' : 'none';
    step2.style.display = step === 2 ? 'block' : 'none';
    step3.style.display = step === 3 ? 'block' : 'none';
    btnPrev.style.display = step > 1 ? 'inline-block' : 'none';
    btnNext.style.display = step === 3 ? 'none' : 'inline-block';
    btnSend.style.display = step === 3 ? 'inline-block' : 'none';
    status.textContent = '';
  }

  modal.querySelectorAll('[data-provider="google"]').forEach(btn => {
    btn.addEventListener('click', () => startOAuth('google'));
  });
  modal.querySelectorAll('[data-provider="facebook"]').forEach(btn => {
    btn.addEventListener('click', () => startOAuth('facebook'));
  });
  modal.querySelectorAll('[data-provider="whatsapp"]').forEach(btn => {
    btn.addEventListener('click', () => selectProvider('whatsapp'));
  });
  modal.querySelectorAll('[data-provider="telegram"]').forEach(btn => {
    btn.addEventListener('click', () => selectProvider('telegram'));
  });
  modal.querySelectorAll('[data-provider="viber"]').forEach(btn => {
    btn.addEventListener('click', () => selectProvider('viber'));
  });
  modal.querySelectorAll('[data-provider="manual"]').forEach(btn => {
    btn.addEventListener('click', () => selectProvider('manual'));
  });

  function startOAuth(provider) {
    socialProvider = provider;
    const msg = modal.querySelector('.ab-oauth-msg');
    msg.textContent = t('oauthSuccess');
    msg.style.display = 'block';
    fetch(`/api/oauth/${provider}`)
      .then(r => {
        if (r.redirected) {
          window.location.href = r.url;
        } else {
          return r.text().then(txt => { throw new Error(txt); });
        }
      })
      .catch(e => console.error('OAuth start error', e));
  }

  function selectProvider(provider) {
    socialProvider = provider;
    oauthData = null;
    showStep(2);
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('oauth') === 'success') {
    const cookie = document.cookie.match(/(^| )cc_oauth=([^;]+)/);
    if (cookie) {
      try {
        oauthData = JSON.parse(decodeURIComponent(cookie[2]));
        socialProvider = oauthData.provider;
        const nameInput = modal.querySelector('#vb-name');
        const emailInput = modal.querySelector('#vb-email');
        if (oauthData.name) nameInput.value = oauthData.name;
        if (oauthData.email) emailInput.value = oauthData.email;
        const msg = modal.querySelector('.ab-oauth-msg');
        msg.textContent = t('oauthSuccess');
        msg.style.display = 'block';
      } catch (e) {
        console.error('OAuth parse error', e);
      }
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  btnNext.addEventListener('click', () => {
    if (currentStep === 1) {
      if (!socialProvider) {
        status.textContent = 'Выберите способ регистрации';
        status.style.color = '#b42318';
        return;
      }
      showStep(2);
    } else if (currentStep === 2) {
      showStep(3);
    }
  });

  btnPrev.addEventListener('click', () => {
    if (currentStep === 3) showStep(2);
    else if (currentStep === 2) showStep(1);
  });

  btnSend.addEventListener('click', async () => {
    const name = (modal.querySelector('#vb-name').value || oauthData?.name || '').trim();
    const email = (modal.querySelector('#vb-email').value || oauthData?.email || '').trim();
    const phone = modal.querySelector('#vb-phone').value.trim();
    const town = (modal.querySelector('#vb-town').value || modal.querySelector('#vb-town2').value || '').trim();
    const type = modal.querySelector('#vb-type').value;
    const services = Array.from(modal.querySelectorAll('.ab-checkboxes input:checked')).map(i => i.value);

    if (!name) {
      status.textContent = 'Укажите имя';
      status.style.color = '#b42318';
      return;
    }
    if (!email && !phone) {
      status.textContent = 'Укажите email или телефон';
      status.style.color = '#b42318';
      return;
    }

    const orig = btnSend.textContent;
    btnSend.textContent = t('sending');
    btnSend.disabled = true;

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          telegram: '',
          town,
          tier: '',
          objectType: type,
          vacancy: '',
          services,
          lang: getLang(),
          ab_variant: VARIANT_B_ID,
          social_provider: socialProvider,
          oauth_provider: oauthData?.provider || null,
          oauth_id: oauthData?.oauth_id || null,
          oauth_email: oauthData?.email || null,
          oauth_name: oauthData?.name || null
        })
      });
      const result = await res.json();
      if (result.ok) {
        status.textContent = t('success');
        status.style.color = '#2a7d4f';
        btnSend.style.display = 'none';
        btnNext.style.display = 'none';
        btnPrev.style.display = 'none';
        setTimeout(() => overlay.remove(), 1500);
      } else {
        status.textContent = result.error || t('error');
        status.style.color = '#b42318';
      }
    } catch (e) {
      status.textContent = t('error');
      status.style.color = '#b42318';
    } finally {
      btnSend.textContent = orig;
      btnSend.disabled = false;
    }
  });

  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  container.appendChild(modal);
}
  }