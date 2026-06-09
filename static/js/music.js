/**
 * MusicUI — handles the music-mode tab on the welcome screen.
 * Supports local file picker/drag-drop and Internet Archive search (via server proxy).
 * All DOM lookups are null-safe so stale HTML cache never crashes the whole app.
 */
export class MusicUI {
  constructor(audio) {
    this._audio            = audio;
    this._isMusicMode      = false;
    this._currentTrack     = null;
    this._hasAutoSearched  = false;
  }

  get isMusicMode() { return this._isMusicMode; }
  get hasTrack()    { return this._currentTrack !== null; }

  setup() {
    this._setupTabs();
    this._setupFileDrop();
    this._setupSearch();
    this._setupMusicToggle();
  }

  // Stop music and reset state (called from main.js stop button).
  stopMusic() {
    this._audio.stopMusic();
    this._currentTrack = null;
    this._isMusicMode  = false;
    this._setStatus('Выбери файл или найди трек выше');
    document.querySelectorAll('.ia-item').forEach(e => e.classList.remove('selected'));
  }

  // Update the in-world track-name bar.
  updateControls() {
    const info = document.getElementById('music-track-info');
    if (!info || !this._currentTrack) return;
    const { title, creator } = this._currentTrack;
    info.textContent = creator ? `${creator} — ${title}` : title;
    info.title = info.textContent;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _setupTabs() {
    const tabMic   = document.getElementById('tab-mic');
    const tabMusic = document.getElementById('tab-music');
    const micPanel = document.getElementById('mic-hint-wrap');
    const musPanel = document.getElementById('music-panel');
    if (!tabMic || !tabMusic || !micPanel || !musPanel) return;

    tabMic.addEventListener('click', () => {
      tabMic.classList.add('active');
      tabMusic.classList.remove('active');
      micPanel.hidden = false;
      musPanel.hidden = true;
      this._isMusicMode = false;
    });

    tabMusic.addEventListener('click', () => {
      tabMusic.classList.add('active');
      tabMic.classList.remove('active');
      micPanel.hidden = true;
      musPanel.hidden = false;
      this._isMusicMode = true;

      if (!this._hasAutoSearched) {
        this._hasAutoSearched = true;
        const inp = document.getElementById('ia-search-input');
        if (inp) inp.value = 'ambient electronic';
        this._doSearch('ambient electronic');
      }
    });
  }

  _setupFileDrop() {
    const zone  = document.getElementById('file-drop');
    const input = document.getElementById('file-input');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files[0]) this._loadFile(input.files[0]);
    });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('audio/')) this._loadFile(f);
    });
  }

  _setupSearch() {
    const form  = document.getElementById('ia-search-form');
    const input = document.getElementById('ia-search-input');
    if (!form || !input) return;

    form.addEventListener('submit', e => {
      e.preventDefault();
      this._doSearch(input.value.trim() || 'ambient electronic');
    });
  }

  _setupMusicToggle() {
    const btn = document.getElementById('music-toggle-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      this._audio.togglePlay();
      btn.textContent = this._audio.paused ? '▶' : '⏸';
    });
  }

  async _doSearch(q) {
    const results = document.getElementById('ia-results');
    if (!results) return;
    results.innerHTML = '<div class="ia-msg">Поиск…</div>';
    try {
      const r    = await fetch(`/api/ia-search?q=${encodeURIComponent(q)}&rows=9`);
      const data = await r.json();
      this._renderResults(data.results || []);
    } catch {
      results.innerHTML = '<div class="ia-msg ia-error">Ошибка поиска. Проверь подключение.</div>';
    }
  }

  _renderResults(items) {
    const container = document.getElementById('ia-results');
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<div class="ia-msg">Ничего не найдено — попробуй другой запрос</div>';
      return;
    }
    container.innerHTML = '';
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'ia-item';
      el.innerHTML =
        `<span class="ia-title">${this._esc(item.title)}</span>` +
        `<span class="ia-meta">${this._esc(item.creator)}${item.year ? ' · ' + item.year : ''}</span>`;
      el.addEventListener('click', () => this._selectTrack(el, item));
      container.appendChild(el);
    }
  }

  async _selectTrack(el, item) {
    document.querySelectorAll('.ia-item').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    this._setStatus('Загрузка трека…');
    try {
      const r = await fetch(`/api/ia-track/${item.id}`);
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      await this._audio.initMusic(data.url, true);
      this._currentTrack = {
        title:   data.title   || item.title,
        creator: data.creator || item.creator,
      };
      const label = (this._currentTrack.creator ? this._currentTrack.creator + ' — ' : '') + this._currentTrack.title;
      this._setStatus(`▶ ${label}`);
    } catch {
      el.classList.remove('selected');
      this._setStatus('Не удалось загрузить трек. Попробуй другой.');
    }
  }

  _loadFile(file) {
    this._setStatus('Загрузка файла…');
    this._audio.initFile(file)
      .then(() => {
        this._currentTrack = { title: file.name, creator: '' };
        this._setStatus(`▶ ${file.name}`);
      })
      .catch(() => this._setStatus('Не удалось загрузить файл.'));
  }

  _setStatus(msg) {
    const el = document.getElementById('music-status');
    if (el) el.textContent = msg;
  }

  _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
