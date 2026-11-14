const VARIANT_A_ID = 'variant-a';

const TEXTS = {
  ru: {
    step1: 'Выберите место объекта на карте',
    step2: 'Тип и частота',
    step3: 'Нужные услуги',
    step4: 'Заполните контакты',
    btnMap: 'Выбрать на карте',
    typeHouse: 'Дом',
    typeApartment: 'Квартира',
    typeLand: 'Участок',
    vacancyMostly: 'Большую часть года',
    vacancySeason: 'Сезонно',
    vacancyOccasional: 'Периодически',
    tabLiving: 'Жильё',
    tabGarden: 'Сад',
    tabPool: 'Бассейн',
    tabGarage: 'Гараж',
    btnPrev: 'Назад',
    btnNext: 'Далее',
    btnSend: 'Отправить заявку',
    sending: 'Отправка...',
    success: 'Заявка отправлена! Мы с вами свяжемся.',
    error: 'Ошибка отправки. Попробуйте ещё раз.',
    placeName: 'Имя',
    placeEmail: 'Email',
    placePhone: 'Телефон / WhatsApp',
    placeTelegram: 'Telegram',
    placeTown: 'Город / зона'
  },
  en: {
    step1: 'Select property location on map',
    step2: 'Type and frequency',
    step3: 'Services needed',
    step4: 'Fill in contacts',
    btnMap: 'Select on map',
    typeHouse: 'House',
    typeApartment: 'Apartment',
    typeLand: 'Land',
    vacancyMostly: 'Most of the year',
    vacancySeason: 'Seasonally',
    vacancyOccasional: 'Occasionally',
    tabLiving: 'Living',
    tabGarden: 'Garden',
    tabPool: 'Pool',
    tabGarage: 'Garage',
    btnPrev: 'Back',
    btnNext: 'Next',
    btnSend: 'Submit request',
    sending: 'Sending...',
    success: 'Request submitted! We will contact you.',
    error: 'Submission error. Try again.',
    placeName: 'Name',
    placeEmail: 'Email',
    placePhone: 'Phone / WhatsApp',
    placeTelegram: 'Telegram',
    placeTown: 'City / zone'
  },
  es: {
    step1: 'Seleccione la ubicación en el mapa',
    step2: 'Tipo y frecuencia',
    step3: 'Servicios necesarios',
    step4: 'Complete los contactos',
    btnMap: 'Seleccionar en el mapa',
    typeHouse: 'Casa',
    typeApartment: 'Apartamento',
    typeLand: 'Terreno',
    vacancyMostly: 'La mayor parte del año',
    vacancySeason: 'Estacional',
    vacancyOccasional: 'Ocasional',
    tabLiving: 'Vivienda',
    tabGarden: 'Jardín',
    tabPool: 'Piscina',
    tabGarage: 'Garaje',
    btnPrev: 'Atrás',
    btnNext: 'Siguiente',
    btnSend: 'Enviar solicitud',
    sending: 'Enviando...',
    success: 'Solicitud enviada. Nos pondremos en contacto.',
    error: 'Error al enviar. Inténtalo de nuevo.',
    placeName: 'Nombre',
    placeEmail: 'Email',
    placePhone: 'Teléfono / WhatsApp',
    placeTelegram: 'Telegram',
    placeTown: 'Ciudad / zona'
  },
  de: {
    step1: 'Standort auf der Karte auswählen',
    step2: 'Typ und Häufigkeit',
    step3: 'Benötigte Dienstleistungen',
    step4: 'Kontaktdaten eingeben',
    btnMap: 'Auf Karte auswählen',
    typeHouse: 'Haus',
    typeApartment: 'Wohnung',
    typeLand: 'Grundstück',
    vacancyMostly: "Das meiste Jahr über",
    vacancySeason: 'Saisonal',
    vacancyOccasional: 'Gelegentlich',
    tabLiving: 'Wohnen',
    tabGarden: 'Garten',
    tabPool: 'Pool',
    tabGarage: 'Garage',
    btnPrev: 'Zurück',
    btnNext: 'Weiter',
    btnSend: 'Anfrage absenden',
    sending: 'Wird gesendet...',
    success: 'Anfrage gesendet! Wir melden uns bei Ihnen.',
    error: 'Fehler beim Absenden. Noch einmal versuchen.',
    placeName: 'Name',
    placeEmail: 'E-Mail',
    placePhone: 'Telefon / WhatsApp',
    placeTelegram: 'Telegram',
    placeTown: 'Stadt / Zone'
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
  container.className = 'ab-modal variant-a';

  const modal = document.createElement('div');
  modal.className = 'ab-modal-overlay';
  modal.innerHTML = `
    <div class="ab-modal-dialog">
      <button class="ab-modal-close" aria-label="Закрыть">×</button>
      <div class="ab-modal-body">
        <div class="ab-step ab-step-1" style="display:block;">
          <div class="ab-step-title">${t('step1')}</div>
          <div class="ab-form-row">
            <button class="ab-btn ab-btn-primary" id="va-map-btn">${t('btnMap')}</button>
            <div id="va-map-hint" style="margin-top:8px; font-size:12px; color:#666;">Выберите зону на карте Тенерифе</div>
          </div>
          <input type="hidden" id="va-town" value="">
          <input type="hidden" id="va-tier" value="">
        <div class="ab-step ab-step-2" style="display:none;">
          <div class="ab-step-title">${t('step2')}</div>
          <div class="ab-form-row">
            <label>Тип объекта</label>
            <select id="va-type">
              <option value="house">${t('typeHouse')}</option>
              <option value="apartment">${t('typeApartment')}</option>
              <option value="land">${t('typeLand')}</option>
            </select>
          </div>
          <div class="ab-form-row">
            <label>Частота ухода</label>
            <select id="va-vacancy">
              <option value="mostly">${t('vacancyMostly')}</option>
              <option value="season">${t('vacancySeason')}</option>
              <option value="occasional">${t('vacancyOccasional')}</option>
            </select>
          </div>
        </div>
        <div class="ab-step ab-step-3" style="display:none;">
          <div class="ab-step-title">${t('step3')}</div>
          <div class="ab-tabs">
            <button class="ab-tab active" data-tab="living">${t('tabLiving')}</button>
            <button class="ab-tab" data-tab="garden">${t('tabGarden')}</button>
            <button class="ab-tab" data-tab="pool">${t('tabPool')}</button>
            <button class="ab-tab" data-tab="garage">${t('tabGarage')}</button>
          </div>
          <div class="ab-tabpanel" id="va-tab-living">
            <label><input type="checkbox" value="inspect"> Осмотр</label>
            <label><input type="checkbox" value="air"> Проветривание</label>
            <label><input type="checkbox" value="meters"> Счётчики</label>
            <label><input type="checkbox" value="prep"> Подготовка к приезду</label>
            <label><input type="checkbox" value="coord"> Координация ремонта</label>
          </div>
          <div class="ab-tabpanel" id="va-tab-garden" style="display:none;">
            <label><input type="checkbox" value="water"> Полив</label>
            <label><input type="checkbox" value="weed"> Прополка</label>
            <label><input type="checkbox" value="lawn"> Стрижка газона</label>
          </div>
          <div class="ab-tabpanel" id="va-tab-pool" style="display:none;">
            <label><input type="checkbox" value="chem"> Химия воды</label>
            <label><input type="checkbox" value="clean"> Чистка</label>
            <label><input type="checkbox" value="equip"> Оборудование</label>
          </div>
          <div class="ab-tabpanel" id="va-tab-garage" style="display:none;">
            <label><input type="checkbox" value="garage-check"> Осмотр гаража</label>
          </div>
        </div>
        <div class="ab-step ab-step-4" style="display:none;">
          <div class="ab-step-title">${t('step4')}</div>
          <div class="ab-form-row">
            <label>${t('placeName')}</label>
            <input type="text" id="va-name" placeholder="${t('placeName')}">
          </div>
          <div class="ab-form-row">
            <label>${t('placeEmail')}</label>
            <input type="email" id="va-email" placeholder="${t('placeEmail')}">
          </div>
          <div class="ab-form-row">
            <label>${t('placePhone')}</label>
            <input type="tel" id="va-phone" placeholder="${t('placePhone')}">
          </div>
          <div class="ab-form-row">
            <label>${t('placeTelegram')}</label>
            <input type="text" id="va-telegram" placeholder="${t('placeTelegram')}">
          </div>
          <input type="hidden" id="va-lang" value="">
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
  const steps = modal.querySelectorAll('.ab-step');
  const btnPrev = modal.querySelector('.ab-btn-prev');
  const btnNext = modal.querySelector('.ab-btn-next');
  const btnSend = modal.querySelector('.ab-btn-send');
  const status = modal.querySelector('.ab-status');

  let currentStep = 1;
  let selectedTown = '';
  let selectedTier = '';

  function showStep(step) {
    currentStep = step;
    steps.forEach((s, i) => { s.style.display = (i + 1 === step) ? 'block' : 'none'; });
    btnPrev.style.display = step > 1 ? 'inline-block' : 'none';
    btnNext.style.display = step === 4 ? 'none' : 'inline-block';
    btnSend.style.display = step === 4 ? 'inline-block' : 'none';
    status.textContent = '';
  }

  const mapBtn = modal.querySelector('#va-map-btn');
  mapBtn.addEventListener('click', () => {
    selectedTown = prompt('Введите город/зону (например, Adeje, Los Cristianos, Guía de Isora)') || '';
    selectedTier = prompt('Введите район/тир (например, Costa Adeje, Arona)') || '';
    if (selectedTown) {
      modal.querySelector('#va-town').value = selectedTown;
      modal.querySelector('#va-tier').value = selectedTier;
      modal.querySelector('#va-map-hint').textContent = `Выбрано: ${selectedTown} (${selectedTier})`;
    }
  });

  modal.querySelectorAll('.ab-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.ab-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.ab-tabpanel').forEach(p => p.style.display = 'none');
      tab.classList.add('active');
      const panel = modal.querySelector(`#va-tab-${tab.dataset.tab}`);
      if (panel) panel.style.display = 'block';
    });
  btnNext.addEventListener('click', () => {
    if (currentStep === 1) {
      if (!selectedTown) {
        status.textContent = 'Выберите локацию';
        status.style.color = '#b42318';
        return;
      }
      showStep(2);
    } else if (currentStep === 2) {
      showStep(3);
    } else if (currentStep === 3) {
      showStep(4);
    }
  });

  btnPrev.addEventListener('click', () => {
    if (currentStep > 1) showStep(currentStep - 1);
  });

  btnSend.addEventListener('click', async () => {
    const name = modal.querySelector('#va-name').value.trim();
    const email = modal.querySelector('#va-email').value.trim();
    const phone = modal.querySelector('#va-phone').value.trim();
    const telegram = modal.querySelector('#va-telegram').value.trim();
    const town = modal.querySelector('#va-town').value.trim();
    const type = modal.querySelector('#va-type').value;
    const vacancy = modal.querySelector('#va-vacancy').value;
    const lang = modal.querySelector('#va-lang').value || getLang();

    const services = [];
    modal.querySelectorAll('.ab-tabpanel input:checked').forEach(cb => services.push(cb.value));

    if (!name) {
      status.textContent = 'Укажите имя';
      status.style.color = '#b42318';
      return;
    }
    if (!email && !phone && !telegram) {
      status.textContent = 'Укажите email, телефон или Telegram';
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
          telegram,
          town,
          tier: selectedTier,
          objectType: type,
          vacancy,
          services,
          lang,
          ab_variant: VARIANT_A_ID,
          social_provider: null,
          oauth_provider: null,
          oauth_id: null,
          oauth_email: null,
          oauth_name: null
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
  });