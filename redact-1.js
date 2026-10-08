(function () {
  'use strict';

  const steps = [
    { id: 'tutorial', label: 'Redact in Action' },
    { id: 'why', label: 'About Elinar' },
    { id: 'demo', label: 'Guided Demo' },
    { id: 'complete', label: 'Tutorial Complete' }
  ];

  const guideSteps = [
    { target: '.zoom-controls', title: 'Adjust zoom', copy: 'Increase or decrease the document zoom to inspect the page comfortably.' },
    { target: '.page-controls', title: 'Navigate pages', copy: 'Move between the pages in the document.' },
    { target: '.toolbar-search', title: 'Search the document', copy: 'Search for a word or phrase, then use Mask all or Unmask all to change every matching appearance.' },
    { target: '#mask-all', title: 'Mask all', copy: 'Select every occurrence of the searched word or phrase in the document.' },
    { target: '#unmask-all', title: 'Unmask all', copy: 'Unselect every occurrence of the searched word or phrase.' },
    { target: '#selection-mode', title: 'Word selection', copy: 'Drag a rectangle over the document to select every whole word it touches. Right click drag to unselect the word.' },
    { target: '#free-selection', title: 'Free selection', copy: 'Drag a rectangle over the document to define the area that will be masked. Right click drag to unselect the area.' },
    { target: '#filter-toggle', title: 'AI proposals', copy: 'Choose which types of information the AI looks for in the document.' },
    { target: '#final-redact', title: 'Apply Redactions', copy: 'Apply the selected redactions after you have reviewed them.' }
  ];

  const categoryLabels = {
    search: 'Search match',
    name: 'Person name',
    address: 'Address',
    email: 'Email',
    phone: 'Phone',
    id: 'Personal ID',
    dob: 'Date of birth'
  };

  const sampleText = `CITY OF HELSINKI
Municipal Services Department
APPLICATION / ADMINISTRATIVE DOCUMENT

Application for municipal support
Reference: HEL-2025-0148     Received: 14 February 2025

APPLICANT DETAILS
Applicant: Nora Example
Address: Example Street 123, 00100 Helsinki
Email: nora.example@example.com
Phone: +358 40 123 4567
Date of birth: 01.01.2001
Personal ID: 010101-123A

APPLICATION DETAILS
The applicant has requested assistance with a temporary housing arrangement while repairs are completed at their current residence. The application was received by the Municipal Services Department on 14 February 2025.

HOUSEHOLD AND SUPPORTING INFORMATION
The applicant has supplied supporting documentation to verify their current circumstances. A caseworker will contact the applicant to arrange a confidential follow-up meeting and confirm the requested support period.

ASSESSMENT NOTES
Eligibility review: In progress
Assigned department: Municipal Housing Services
Document classification: Confidential — personal data

This fictional document is provided for demonstration only. All names, contact details, identification numbers and circumstances are invented.`;

  const state = {
    screen: 'home',
    reachedSteps: new Set(),
    tutorialRedacted: false,
    tutorialRedactedOnce: false,
    entities: [],
    sourceText: '',
    filename: 'Municipal_Application.pdf',
    fileKind: 'sample',
    fileUrl: '',
    filters: new Set(Object.keys(categoryLabels)),
    selectionMode: false,
    sourceIsEditable: true,
    toastTimer: 0,
    guideIndex: -1,
    guideDismissed: false,
    guideHoverOnly: false,
    clarificationTimer: 0,
    clarificationTarget: null,
    tutorialPage: 1,
    zoom: 1,
    freeSelectionMode: false,
    dragStart: null,
    dragBox: null,
    dragButton: 0,
    didDrag: false,
    freeSelections: [],
    realToolActive: false,
    tutorialActive: false,
    redactionApplied: false,
    notificationSeen: false,
    transitionTimer: 0,
    homeIntroSeen: false,
    introMovement: null,
    introTimer: 0,
    introCleanupTimer: 0,
    introFrame: 0
  };

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function makeSampleEntities() {
    return [
      { category: 'name', value: 'Nora Example', selected: true, redacted: false },
      { category: 'address', value: 'Example Street 123, 00100 Helsinki', selected: true, redacted: false },
      { category: 'email', value: 'nora.example@example.com', selected: true, redacted: false },
      { category: 'phone', value: '+358 40 123 4567', selected: true, redacted: false },
      { category: 'dob', value: '01.01.2001', selected: true, redacted: false },
      { category: 'id', value: '010101-123A', selected: true, redacted: false }
    ];
  }

  function detectTextEntities(text) {
    const candidates = [];
    const patterns = [
      ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
      ['id', /\b\d{6}[-+A]\d{3}[A-Z0-9]\b/gi],
      ['phone', /\+?\d[\d ()-]{7,}\d/g],
      ['dob', /\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)?\d{2,4}\b/g],
      ['address', /\b(?:\d+[A-Z]?\s+(?:[\p{L}.'-]+\s+){1,3}(?:Street|Road|Avenue|Lane|St\.?|Rd\.?|Katu|Tie)|(?:[\p{L}]+\s+){0,3}(?:Street|Road|Avenue|Lane|St\.?|Rd\.?|Katu|Tie)\s+\d+[A-Z]?)(?:,?\s+\d{5})?(?:\s+[\p{L} -]+)?/giu],
      ['name', /(?:Applicant|Name|Contact person)\s*:\s*([\p{L}][\p{L}' -]{1,45})/giu]
    ];

    for (const [category, expression] of patterns) {
      for (const match of text.matchAll(expression)) {
        const captured = match[1] || match[0];
        const offset = match.index + (match[1] ? match[0].indexOf(captured) : 0);
        if (!candidates.some(function (item) { return offset < item.end && offset + captured.length > item.start; })) {
          candidates.push({ start: offset, end: offset + captured.length, category, value: captured });
        }
      }
    }

    candidates.sort(function (first, second) { return first.start - second.start; });
    return candidates.map(function (item) { return { ...item, selected: true, redacted: false }; });
  }

  function createWordEntities(text, entities) {
    const words = [];
    const expression = /[\p{L}\p{N}]+(?:[.'’-][\p{L}\p{N}]+)*/gu;
    for (const match of text.matchAll(expression)) {
      const start = match.index;
      const end = start + match[0].length;
      if (entities.some(function (entity) {
        const entityStart = Number.isInteger(entity.start) ? entity.start : text.indexOf(entity.value);
        const entityEnd = Number.isInteger(entity.end) ? entity.end : entityStart + entity.value.length;
        return entityStart >= 0 && start < entityEnd && end > entityStart;
      })) continue;
      words.push({ category: 'word', value: match[0], start, end, selected: false, redacted: false });
    }
    return words;
  }

  function isSuggestion(entity) {
    return entity.category !== 'search' && entity.category !== 'word';
  }

  function createProgress() {
    const list = $('#progress-steps');
    list.innerHTML = '';
    steps.forEach(function (step, index) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'progress-step';
      button.dataset.step = step.id;
      button.setAttribute('aria-label', `Step ${index + 1}: ${step.label}`);
      button.innerHTML = `<span aria-hidden="true">${index === steps.length - 1 ? '✓' : index + 1}</span>`;
      const label = document.createElement('span');
      label.className = 'progress-step-label';
      label.textContent = step.label;
      item.append(button, label);
      list.append(item);
    });
  }

  function renderProgress() {
    const currentIndex = state.screen === 'review' && state.tutorialActive ? 2
      : state.screen === 'complete' && state.completionMode === 'tutorial-saving' ? 2
        : state.screen === 'complete' && state.completionMode === 'tutorial-complete' ? 3
        : steps.findIndex(function (step) { return step.id === state.screen; });
    const highestReachedIndex = steps.reduce(function (highest, step, index) {
      return state.reachedSteps.has(step.id) ? Math.max(highest, index) : highest;
    }, -1);
    $$('.progress-step').forEach(function (button, index) {
      const current = index === currentIndex;
      const complete = index < highestReachedIndex;
      button.classList.toggle('is-current', current);
      button.classList.toggle('is-complete', complete);
      button.disabled = !state.tutorialActive || !state.reachedSteps.has(button.dataset.step);
      button.setAttribute('aria-current', current ? 'step' : 'false');
      const label = button.nextElementSibling;
      label.classList.toggle('is-active', current);
      if (current) label.classList.add('is-active');
    });
    $('#progress-fill').style.width = `${Math.max(0, highestReachedIndex) * (100 / (steps.length - 1))}%`;
  }

  function navigate(screen) {
    const isTutorialRoute = steps.some(function (step) { return step.id === screen; }) || (screen === 'review' && state.tutorialActive);
    if (!isTutorialRoute && !['home', 'demo', 'review', 'complete'].includes(screen)) return;
    state.screen = screen;
    if (screen !== 'review') closeGuide();
    if (state.tutorialActive) {
      const reachedId = screen === 'review' ? 'demo'
        : screen === 'complete' && state.completionMode !== 'tutorial-complete' ? ''
          : screen;
      if (steps.some(function (step) { return step.id === reachedId; })) state.reachedSteps.add(reachedId);
    }
    $('.app-shell').classList.toggle('is-home', screen === 'home');
    $('#progress-nav').hidden = !state.tutorialActive || screen === 'home' || state.realToolActive;
    $('#footer-context').textContent = state.realToolActive ? 'PRIVATE WORKSPACE' : 'DEMO · FICTIONAL DATA';
    $('#chat-notification-badge').hidden = screen !== 'home' || state.notificationSeen;
    $$('[data-screen]').forEach(function (section) {
      section.hidden = section.dataset.screen !== screen;
    });
    if (screen === 'complete') {
      const tutorialComplete = state.completionMode === 'tutorial-complete';
      $('[data-screen="complete"]').setAttribute('aria-labelledby', tutorialComplete ? 'tutorial-complete-title' : 'complete-title');
      $('#tutorial-completion-panel').hidden = !tutorialComplete;
      $('.tutorial-save-next').hidden = state.completionMode !== 'tutorial-saving';
      $('.tool-save-next').hidden = state.completionMode === 'tutorial-saving';
      $$('.complete-topline, .complete-layout, .complete-footer').forEach(function (element) {
        element.hidden = tutorialComplete;
      });
    }
    renderProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeGuide() {
    state.guideIndex = -1;
    state.guideHoverOnly = false;
    $('#guide-callout').hidden = true;
    $('#guide-callout').classList.remove('is-hover-only');
    $$('.guided-highlight').forEach(function (element) { element.classList.remove('guided-highlight'); });
  }

  function hideToolClarification() {
    window.clearTimeout(state.clarificationTimer);
    state.clarificationTimer = 0;
    state.clarificationTarget = null;
    const clarification = $('#tool-clarification');
    if (clarification) clarification.hidden = true;
  }

  function showToolClarification(target, step) {
    const clarification = $('#tool-clarification');
    if (!clarification) return;
    const title = $('.tool-clarification-title', clarification);
    const copy = $('.tool-clarification-copy', clarification);
    title.textContent = step.title;
    copy.textContent = step.copy;
    clarification.hidden = false;
    const rect = target.getBoundingClientRect();
    const bounds = clarification.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - 12));
    const top = rect.bottom + 9;
    clarification.style.left = `${left}px`;
    clarification.style.top = `${top}px`;
  }

  function scheduleToolClarification(target) {
    hideToolClarification();
    const selector = guideSteps.map(function (step) { return step.target; }).join(',');
    const matchedTarget = target.closest(selector);
    if (!matchedTarget) return;
    const index = guideSteps.findIndex(function (step) { return matchedTarget.matches(step.target); });
    if (index < 0) return;
    state.clarificationTarget = matchedTarget;
    state.clarificationTimer = window.setTimeout(function () {
      if (state.clarificationTarget === matchedTarget && state.realToolActive && state.screen === 'review') {
        showToolClarification(matchedTarget, guideSteps[index]);
      }
    }, 500);
  }

  function positionGuideCallout() {
    if (state.guideIndex < 0) return;
    const step = guideSteps[state.guideIndex];
    const target = $(step.target);
    const callout = $('#guide-callout');
    if (!target || target.getClientRects().length === 0) return;

    const rect = target.getBoundingClientRect();
    const bounds = callout.getBoundingClientRect();
    const margin = 12;
    const reviewScreen = $('[data-screen="review"]');
    const screenRect = reviewScreen.getBoundingClientRect();
    const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - margin));
    const top = rect.bottom + 13;
    const arrowLeft = Math.max(18, Math.min(rect.left + rect.width / 2 - left, bounds.width - 18));
    callout.style.left = `${left - screenRect.left + reviewScreen.scrollLeft}px`;
    callout.style.top = `${top - screenRect.top + reviewScreen.scrollTop}px`;
    callout.style.setProperty('--guide-arrow-left', `${arrowLeft}px`);
    callout.classList.add('is-below');
  }

  function showGuideStep(index, hoverOnly = false) {
    state.guideDismissed = hoverOnly;
    state.guideHoverOnly = hoverOnly;
    state.guideIndex = Math.max(0, Math.min(index, guideSteps.length - 1));
    const step = guideSteps[state.guideIndex];
    const callout = $('#guide-callout');
    $$('.guided-highlight').forEach(function (element) { element.classList.remove('guided-highlight'); });
    $('#guide-step-label').textContent = `STEP ${state.guideIndex + 1} OF ${guideSteps.length}`;
    $('#guide-title').textContent = step.title;
    $('#guide-copy').textContent = step.copy;
    $('#guide-back').hidden = hoverOnly || state.guideIndex === 0;
    $('#guide-next').hidden = hoverOnly || state.guideIndex === guideSteps.length - 1;
    $('#guide-close').hidden = hoverOnly || state.guideIndex !== guideSteps.length - 1;
    callout.hidden = false;
    callout.classList.toggle('is-hover-only', hoverOnly);

    const target = $(step.target);
    target?.classList.add('guided-highlight');
    window.requestAnimationFrame(positionGuideCallout);
  }

  function startGuidedTour() {
    resetWorkflowState();
    state.realToolActive = false;
    state.tutorialActive = true;
    state.reachedSteps = new Set(['tutorial', 'why']);
    navigate('demo');
    renderUploadScreen();
  }

  function showAssistantTip() {
    const dock = $('#assistant-dock');
    dock.hidden = false;
    $('#assistant-notification').hidden = false;
    $('#chat-window').hidden = true;
    $('#help-button').setAttribute('aria-expanded', 'false');
    positionAssistantDock();
  }

  function startTutorialTransition() {
    resetWorkflowState();
    state.tutorialActive = true;
    window.clearTimeout(state.transitionTimer);
    const main = $('#app-main');
    main.classList.add('is-transitioning');
    state.transitionTimer = window.setTimeout(function () {
      main.classList.remove('is-transitioning');
      renderTutorial();
      navigate('tutorial');
    }, 360);
  }

  function initializeLogos() {
    const template = $('#elinar-logo-template');
    $$('.elinar-mark').forEach(function (container) {
      container.append(template.content.cloneNode(true));
    });
  }

  function finishHomeIntro() {
    const splash = $('#intro-splash');
    const introLogo = $('#intro-logo');
    const brand = $('.brand');
    const start = introLogo.getBoundingClientRect();
    const destinationMark = $('.brand .elinar-mark').getBoundingClientRect();
    const destinationName = $('.brand .brand-name').getBoundingClientRect();
    const destination = {
      left: destinationMark.left,
      top: destinationMark.top,
      width: destinationName.right - destinationMark.left
    };
    const scale = destination.width / start.width;
    const translateX = destination.left - start.left;
    const translateY = destination.top - start.top;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof introLogo.animate !== 'function') {
      brand.classList.remove('logo-arriving');
      brand.classList.add('is-logo-visible');
      splash.classList.add('is-dismissing');
      splash.hidden = true;
      return;
    }

    introLogo.style.position = 'fixed';
    introLogo.style.left = `${start.left}px`;
    introLogo.style.top = `${start.top}px`;
    introLogo.style.margin = '0';
    introLogo.style.transformOrigin = 'top left';
    introLogo.style.zIndex = '55';
    const movement = introLogo.animate([
      { transform: 'translate(0, 0) scale(1)' },
      { transform: `translate(${translateX}px, ${translateY}px) scale(${scale})` }
    ], { duration: 650, easing: 'cubic-bezier(.22,.72,.22,1)', fill: 'forwards' });
    state.introMovement = movement;

    movement.onfinish = function () {
      brand.classList.add('is-logo-visible');
      brand.classList.remove('logo-arriving');
      splash.classList.add('is-dismissing');
      state.introCleanupTimer = window.setTimeout(function () {
        state.introCleanupTimer = 0;
        splash.hidden = true;
        introLogo.style.cssText = '';
        if (state.introMovement === movement) {
          movement.cancel();
          state.introMovement = null;
        }
      }, 240);
    };
  }

  function playHomeIntro() {
    const splash = $('#intro-splash');
    const brand = $('.brand');
    const introLogo = $('#intro-logo');
    window.clearTimeout(state.introTimer);
    window.clearTimeout(state.introCleanupTimer);
    window.cancelAnimationFrame(state.introFrame);
    state.introTimer = 0;
    state.introCleanupTimer = 0;
    state.introFrame = 0;
    if (state.introMovement) {
      state.introMovement.onfinish = null;
      state.introMovement.cancel();
      state.introMovement = null;
    }
    splash.hidden = false;
    splash.classList.remove('is-dismissing', 'is-complete', 'is-playing');
    introLogo.style.cssText = '';
    brand.classList.add('logo-arriving');
    brand.classList.remove('is-logo-visible');
    state.homeIntroSeen = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      brand.classList.remove('logo-arriving');
      brand.classList.add('is-logo-visible');
      splash.hidden = true;
      return;
    }
    state.introFrame = window.requestAnimationFrame(function () {
      state.introFrame = 0;
      splash.classList.add('is-playing');
      state.introTimer = window.setTimeout(function () {
        state.introTimer = 0;
        splash.classList.add('is-complete');
        state.introTimer = window.setTimeout(function () {
          state.introTimer = 0;
          finishHomeIntro();
        }, 300);
      }, 2500);
    });
  }

  function goHome() {
    resetWorkflowState();
    navigate('home');
    playHomeIntro();
  }

  function startRealTool() {
    resetWorkflowState();
    state.realToolActive = true;
    state.tutorialActive = false;
    navigate('demo');
    renderUploadScreen();
    showAssistantTip();
  }

  function renderUploadScreen() {
    const guided = state.tutorialActive && !state.realToolActive;
    $('#demo-title').textContent = guided ? 'Guided Demo' : 'Redact Tool';
    $('#upload-eyebrow').textContent = guided ? 'TRY IT YOURSELF / 03' : 'YOUR WORKSPACE';
    $('#upload-description').textContent = guided
      ? 'Step 1: Choose file. Upload a document to begin the guided walkthrough.'
      : 'Upload a document to review sensitive details and choose what to redact.';
    $('#upload-title').textContent = guided ? 'Step 1 · Choose file' : 'Upload your own document';
    $('#upload-back').hidden = !guided;
    $('.upload-home-back').hidden = guided;
    $('#demo-sample-document').hidden = !guided;
  }

  function finishGuidedTutorial() {
    closeGuide();
    state.completionMode = 'tutorial-complete';
    navigate('complete');
  }

  function finishTutorialSave() {
    state.completionMode = 'tutorial-complete';
    state.reachedSteps.add('complete');
    navigate('complete');
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, function (character) { return ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]; });
  }

  function renderDocument(target, text, entities, options = {}) {
    const interactive = Boolean(options.interactive);
    const offsets = entities.map(function (entity, index) {
      const start = Number.isInteger(entity.start) ? entity.start : text.indexOf(entity.value);
      return start < 0 ? null : { start, end: start + entity.value.length, entity, index };
    }).filter(Boolean).sort(function (first, second) { return first.start - second.start; });

    let output = '';
    let cursor = 0;
    for (const token of offsets) {
      if (token.start < cursor) continue;
      output += escapeHtml(text.slice(cursor, token.start));
      const classes = ['paper-entity'];
      if (token.entity.selected) classes.push('is-selected');
      if (token.entity.redacted) classes.push('is-redacted');
      if (token.entity.category === 'search' || entities.some(function (entity) {
        const matchStart = Number.isInteger(entity.start) ? entity.start : text.indexOf(entity.value);
        const matchEnd = Number.isInteger(entity.end) ? entity.end : matchStart + entity.value.length;
        return entity.category === 'search' && token.start < matchEnd && token.end > matchStart;
      })) classes.push('is-search-match');
      if (isSuggestion(token.entity) && !state.filters.has(token.entity.category)) classes.push('is-filtered');
      const label = token.entity.redacted ? 'Redacted' : token.entity.value;
      if (interactive) {
        const redactionStyle = token.entity.redacted ? ` style="--redaction-width: ${Math.max(1, token.entity.value.length)}ch"` : '';
        output += `<button type="button" class="${classes.join(' ')}"${redactionStyle} data-entity-index="${token.index}" aria-pressed="${token.entity.selected}" aria-label="${escapeHtml(categoryLabels[token.entity.category] || 'Document word')}: ${escapeHtml(label)}">${token.entity.redacted ? '<span class="visually-hidden">Redacted</span>' : escapeHtml(token.entity.value)}</button>`;
      } else {
        output += `<span class="${classes.join(' ')}" aria-label="${escapeHtml(label)}">${token.entity.redacted ? '<span class="visually-hidden">Redacted</span>' : escapeHtml(token.entity.value)}</span>`;
      }
      cursor = token.end;
    }
    output += escapeHtml(text.slice(cursor));

    const paragraphs = output.split(/\n\s*\n/);
    target.innerHTML = paragraphs.map(function (paragraph, index) {
      if (index === 0) return `<div class="paper-kicker">CITY OF HELSINKI &nbsp; / &nbsp; MUNICIPAL SERVICES</div><h3 class="paper-heading">${paragraph.replace(/\n/g, '<br>')}</h3>`;
      const lines = paragraph.split('\n');
      const renderedLines = lines.map(function (line) {
        if (/^(APPLICANT DETAILS|APPLICATION DETAILS|HOUSEHOLD AND SUPPORTING INFORMATION|ASSESSMENT NOTES|DOCUMENT CLASSIFICATION)$/i.test(line.trim())) return `<div class="paper-section">${line}</div>`;
        if (/^CITY OF HELSINKI$/.test(line.trim()) || /^Municipal Services Department$/.test(line.trim()) || /^APPLICATION \/ ADMINISTRATIVE DOCUMENT$/.test(line.trim())) return `<div>${line}</div>`;
        return `<p>${line || '&nbsp;'}</p>`;
      }).join('');
      return `<div class="paper-block">${renderedLines}</div>`;
    }).join('');
  }

  function renderTutorial() {
    const entities = makeSampleEntities().map(function (entity) { return { ...entity, redacted: state.tutorialRedacted }; });
    renderDocument($('#tutorial-paper'), sampleText, entities);
    const tutorialPageCurrent = $('.page-current', $('.tutorial-viewer'));
    if (tutorialPageCurrent) tutorialPageCurrent.textContent = String(state.tutorialPage);
    $('#tutorial-redact').disabled = false;
    $('#tutorial-redact').textContent = state.tutorialRedacted ? 'Undo' : 'Redact';
    $('#tutorial-next').disabled = !state.tutorialRedactedOnce;
    const status = $('#tutorial-status');
    status.classList.toggle('is-success', state.tutorialRedacted);
    status.innerHTML = state.tutorialRedacted ? '<span class="status-dot"></span> 6 details redacted successfully' : '<span class="status-dot"></span> Ready to redact';
    $('#tutorial-redaction-note').hidden = !state.tutorialRedacted;
  }

  function updateFilterMenu() {
    const options = $('#filter-options');
    options.innerHTML = '';
    Object.entries(categoryLabels).forEach(function ([category, label]) {
      if (category === 'search') return;
      const wrapper = document.createElement('label');
      wrapper.className = 'filter-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = category;
      checkbox.checked = state.filters.has(category);
      const text = document.createElement('span');
      text.textContent = label;
      wrapper.append(checkbox, text);
      options.append(wrapper);
    });
  }

  function renderEntities() {
    const list = $('#entity-list');
    list.innerHTML = '';
    state.entities.forEach(function (entity, index) {
      if (!isSuggestion(entity)) return;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'entity-item';
      item.classList.toggle('is-selected', entity.selected);
      item.classList.toggle('is-redacted', entity.redacted);
      item.dataset.entityIndex = index;
      item.setAttribute('aria-pressed', String(entity.selected));
      const checkbox = document.createElement('span');
      checkbox.className = 'entity-checkbox';
      checkbox.setAttribute('aria-hidden', 'true');
      checkbox.textContent = entity.redacted ? '−' : '✓';
      const copy = document.createElement('span');
      copy.className = 'entity-copy';
      const value = document.createElement('strong');
      value.textContent = entity.redacted ? 'Redacted' : entity.value;
      const category = document.createElement('small');
      category.textContent = categoryLabels[entity.category];
      copy.append(value, category);
      const badge = document.createElement('span');
      badge.className = 'entity-category';
      badge.textContent = entity.redacted ? 'Masked' : 'Suggested';
      item.append(checkbox, copy, badge);
      list.append(item);
    });
    let selectAll = $('#select-all-suggestions');
    if (!selectAll) {
      selectAll = document.createElement('button');
      selectAll.type = 'button';
      selectAll.id = 'select-all-suggestions';
      selectAll.className = 'select-all-suggestions';
      list.parentElement.append(selectAll);
    }
    const suggestions = state.entities.filter(isSuggestion);
    selectAll.hidden = suggestions.length === 0;
    const allSelected = suggestions.length > 0 && suggestions.every(function (entity) { return entity.selected; });
    selectAll.textContent = allSelected ? 'Deselect all' : 'Select all';
    selectAll.setAttribute('aria-label', allSelected ? 'Deselect all suggestions' : 'Select all suggestions');
    selectAll.disabled = suggestions.length === 0;

    const total = suggestions.length;
    const selected = suggestions.filter(function (entity) { return entity.selected && state.filters.has(entity.category); }).length;
    $('#suggestion-count').textContent = `${total} ${total === 1 ? 'suggestion' : 'suggestions'}`;
    $('#sidebar-suggestion-count').textContent = String(total);
    $('#selected-count').textContent = `${selected} selected`;
    $('#empty-detections').hidden = total !== 0;
    $('#entity-list').hidden = total === 0;
    $('#final-redact').disabled = false;
    $('#mask-all').disabled = getSearchMatches().length === 0;
    $('#unmask-all').disabled = !getSearchMatches().some(function (entity) { return entity.selected; });
  }

  function renderReview() {
    $('#review-title').textContent = state.realToolActive ? 'Redact Tool' : 'Guided Demo';
    $('.review-heading .eyebrow').innerHTML = state.realToolActive ? 'YOUR WORKSPACE' : 'TRY IT YOURSELF <span class="eyebrow-separator">/</span> 03';
    $('.review-heading p').textContent = state.realToolActive ? 'Review suggested details and decide what to redact.' : 'Review your document and explore the redaction tools.';
    $('#review-live-status').textContent = state.realToolActive ? 'Ready for your review.' : $('#review-live-status').textContent;
    $('#review-file-name').textContent = state.filename;
    $('#review-file-detail').textContent = state.fileKind === 'sample' ? 'Municipal services · sample document' : `${state.fileKind.toUpperCase()} · local preview`;
    $('#review-file-icon').textContent = state.fileKind === 'image' ? 'IMG' : state.fileKind === 'text' ? 'TXT' : 'PDF';
    $('#review-page-status').textContent = state.fileKind === 'sample' ? 'Sample document' : 'Local file preview';
    $('#review-bottom-back').textContent = state.realToolActive ? 'Back to upload' : 'Back';
    $('#review-bottom-back').hidden = !state.tutorialActive && !state.realToolActive;
    $('#finish-redaction').hidden = !state.redactionApplied;
    $('#choose-another-document').hidden = state.tutorialActive && state.redactionApplied;
    const paper = $('#review-paper');
    $('#review-paper-scroll').classList.toggle('is-selecting', state.selectionMode);
    $('#review-paper-scroll').classList.toggle('is-free-selecting', state.freeSelectionMode);
    $('#review-paper').style.transform = `scale(${state.zoom})`;
    $('#review-paper').style.transformOrigin = 'top center';
    paper.classList.toggle('external-preview', state.fileKind === 'pdf' || state.fileKind === 'image');
    if (state.fileKind === 'pdf') {
      paper.innerHTML = `<iframe title="Uploaded PDF preview" src="${escapeHtml(state.fileUrl)}"></iframe>`;
      $('#review-hint').textContent = 'PDF preview is local. Upload a text file to review editable suggestions.';
    } else if (state.fileKind === 'image') {
      paper.innerHTML = `<img src="${escapeHtml(state.fileUrl)}" alt="Uploaded document preview">`;
      $('#review-hint').textContent = 'Image preview is local. Upload a text file to review editable suggestions.';
    } else {
      $('#review-hint').innerHTML = state.selectionMode
        ? '<span aria-hidden="true">⌖</span> Select details directly in the document.'
        : '<span aria-hidden="true">⌁</span> Turn on Direct selection to choose highlights in the document; the sidebar is always available.';
      renderDocument(paper, state.sourceText, state.entities, { interactive: true });
      state.freeSelections.forEach(function (selection) {
        const overlay = document.createElement('div');
        overlay.className = `free-redaction-box${selection.redacted ? ' is-redacted' : ''}`;
        Object.assign(overlay.style, {
          left: `${selection.left}px`,
          top: `${selection.top}px`,
          width: `${selection.width}px`,
          height: `${selection.height}px`
        });
        paper.append(overlay);
      });
    }
    renderEntities();
    updateReviewPageControls();
  }

  function updateReviewPageControls() {
    const viewer = $('.review-viewer');
    const currentPage = Number(viewer?.dataset.page || 1);
    const totalPages = Number(viewer?.dataset.pageTotal || 2);
    $('#review-page-prev').disabled = currentPage <= 1;
    $('#review-page-next').disabled = currentPage >= totalPages;
    $('.page-controls span').textContent = `${currentPage} / ${totalPages}`;
  }

  function setDocumentPage(viewer, page) {
    const total = Number(viewer.dataset.pageTotal || 1);
    const nextPage = Math.max(1, Math.min(page, total));
    viewer.dataset.page = String(nextPage);
    const current = $('.page-current', viewer);
    if (current) current.textContent = String(nextPage);
    const toolbarPage = $('.page-controls span');
    if (toolbarPage && viewer.classList.contains('review-viewer')) toolbarPage.textContent = `${nextPage} / ${total}`;
    $$('[data-page-action]', viewer).forEach(function (button) {
      button.disabled = button.dataset.pageAction === 'previous' ? nextPage === 1 : nextPage === total;
    });
  }

  function buildReviewToolbar() {
    const toolbar = $('.review-toolbar');
    toolbar.innerHTML = `<div class="toolbar-group zoom-controls"><button class="tool-button" id="zoom-out" type="button" aria-label="Zoom out">−</button><span id="zoom-level">100%</span><button class="tool-button" id="zoom-in" type="button" aria-label="Zoom in">+</button></div><div class="toolbar-group page-controls"><button class="tool-button" id="review-page-prev" type="button" aria-label="Previous page">‹</button><span>1 / 2</span><button class="tool-button" id="review-page-next" type="button" aria-label="Next page">›</button></div><div class="toolbar-search"><input id="document-search" type="search" placeholder="Find word or phrase in the document" aria-label="Find word or phrase in the document"><button class="tool-button" id="find-selection" type="button">Find</button></div><button class="tool-button" id="mask-all" type="button">Mask all</button><button class="tool-button" id="unmask-all" type="button">Unmask all</button><button class="tool-button mode-button" id="selection-mode" type="button" aria-pressed="false">Word selection</button><button class="tool-button mode-button" id="free-selection" type="button" aria-pressed="false">Free selection</button><div class="filter-wrap"><button class="tool-button" id="filter-toggle" type="button" aria-expanded="false">AI proposals</button><div class="filter-menu" id="filter-menu" hidden><strong>Show categories</strong><div id="filter-options"></div><button class="filter-reset" id="clear-filters" type="button">Show all</button></div></div><button class="button button-primary toolbar-redact" id="final-redact" type="button">Apply Redactions</button>`;
  }

  function updateSearch(value) {
    const query = value.trim().toLowerCase();
    const selectedSearchMatches = state.entities.filter(function (entity) { return entity.category === 'search' && entity.selected; });
    selectedSearchMatches.forEach(function (match) {
      state.entities.filter(function (entity) { return entity.category === 'word' || isSuggestion(entity); }).forEach(function (entity) {
        if (entity.start < match.end && entity.end > match.start) entity.selected = true;
      });
    });
    state.entities = state.entities.filter(function (entity) { return entity.category !== 'search'; });
    if (query) {
      const source = state.sourceText.toLowerCase();
      let start = source.indexOf(query);
      while (start >= 0) {
        state.entities.push({
          category: 'search',
          value: state.sourceText.slice(start, start + query.length),
          start,
          end: start + query.length,
          selected: false,
          redacted: false
        });
        start = source.indexOf(query, start + query.length);
      }
      state.entities.sort(function (first, second) { return first.start - second.start; });
    }
    renderReview();
  }

  function getSearchMatches() {
    return state.entities.filter(function (entity) { return entity.category === 'search'; });
  }

  function getSearchTargets() {
    const matches = getSearchMatches();
    return state.entities.filter(function (entity) {
      if (entity.category === 'search') return true;
      const start = Number.isInteger(entity.start) ? entity.start : state.sourceText.indexOf(entity.value);
      const end = Number.isInteger(entity.end) ? entity.end : start + entity.value.length;
      return matches.some(function (match) { return start < match.end && end > match.start; });
    });
  }

  function updateDragBox(event) {
    if (!state.dragStart) return;
    const paper = $('#review-paper');
    const paperRect = paper.getBoundingClientRect();
    const x = Math.max(paperRect.left, Math.min(event.clientX, paperRect.right));
    const y = Math.max(paperRect.top, Math.min(event.clientY, paperRect.bottom));
    const current = { x: (x - paperRect.left) / state.zoom, y: (y - paperRect.top) / state.zoom };
    const box = { left: Math.min(state.dragStart.x, current.x), top: Math.min(state.dragStart.y, current.y), width: Math.abs(current.x - state.dragStart.x), height: Math.abs(current.y - state.dragStart.y) };
    state.dragBox = box;
    let overlay = $('.selection-box', paper);
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'selection-box'; paper.append(overlay); }
    Object.assign(overlay.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  }

  function finishDrag() {
    if (!state.dragBox) { state.dragStart = null; return; }
    const paperRect = $('#review-paper').getBoundingClientRect();
    const box = state.dragBox;
    const paperBox = {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height
    };
    const shouldSelect = state.dragButton !== 2;
    state.entities.forEach(function (entity, index) {
      const element = $(`[data-entity-index="${index}"]`, $('#review-paper'));
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const left = (rect.left - paperRect.left) / state.zoom;
      const top = (rect.top - paperRect.top) / state.zoom;
      const width = rect.width / state.zoom;
      const height = rect.height / state.zoom;
      const touches = left < paperBox.left + paperBox.width && left + width > paperBox.left && top < paperBox.top + paperBox.height && top + height > paperBox.top;
      if (touches) {
        entity.selected = shouldSelect;
        if (!shouldSelect && entity.redacted) entity.redacted = false;
      }
    });
    if (state.freeSelectionMode && paperBox.width > 2 && paperBox.height > 2) {
      if (shouldSelect) {
        state.freeSelections.push({ ...paperBox, redacted: false });
      } else {
        state.freeSelections = state.freeSelections.filter(function (selection) {
          return !boxesTouch(selection, paperBox);
        });
      }
    }
    $('.selection-box', $('#review-paper'))?.remove();
    state.dragStart = null;
    state.dragBox = null;
    state.dragButton = 0;
    state.didDrag = paperBox.width > 2 || paperBox.height > 2;
    renderReview();
  }

  function boxesTouch(first, second) {
    return first.left < second.left + second.width && first.left + first.width > second.left
      && first.top < second.top + second.height && first.top + first.height > second.top;
  }

  function initializePageControls() {
    $$('.paper-viewer').forEach(function (viewer) {
      const count = $('.page-count', viewer);
      if (!count || count.querySelector('[data-page-action]')) return;
      const total = count.textContent.match(/(?:OF|of)\s+(\d+)/)?.[1];
      if (!total) return;
      const current = $('strong', count);
      if (!current) return;
      viewer.dataset.pageTotal = total;
      current.classList.add('page-current');
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'page-switch';
      previous.dataset.pageAction = 'previous';
      previous.textContent = '‹';
      previous.setAttribute('aria-label', 'Previous page');
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'page-switch';
      next.dataset.pageAction = 'next';
      next.textContent = '›';
      next.setAttribute('aria-label', 'Next page');
      count.prepend(previous);
      count.append(next);
    });
  }

  function setSampleDocument() {
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = '';
    state.filename = 'Municipal_Application.pdf';
    state.fileKind = 'sample';
    state.sourceText = sampleText;
    state.entities = makeSampleEntities();
    state.entities.push(...createWordEntities(state.sourceText, state.entities));
    state.sourceIsEditable = true;
    state.filters = new Set(Object.keys(categoryLabels));
    state.selectionMode = false;
    state.freeSelectionMode = false;
    state.zoom = 1;
    state.freeSelections = [];
    state.dragStart = null;
    state.dragBox = null;
    $('#selection-mode').setAttribute('aria-pressed', 'false');
    $('#selection-mode').textContent = 'Word selection';
    $('#free-selection').setAttribute('aria-pressed', 'false');
    $('#review-paper-scroll').classList.remove('is-selecting', 'is-free-selecting');
    $('.review-viewer').dataset.page = '1';
    $('.review-viewer').dataset.pageTotal = '2';
    $('.page-controls span').textContent = '1 / 2';
    $('#review-live-status').textContent = 'Sample loaded. Review each suggestion before redacting.';
  }

  function loadGuidedSample() {
    if (!state.tutorialActive || state.realToolActive) return;
    setSampleDocument();
    navigate('review');
    state.reachedSteps.add('demo');
    renderReview();
    showGuideStep(0);
  }

  function updateEntities(mutator) {
    state.entities.forEach(function (entity, index) { mutator(entity, index); });
    renderReview();
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () { toast.classList.remove('is-visible'); }, 2800);
  }

  function redactSelected() {
    const chosen = state.entities.filter(function (entity) { return entity.selected; });
    if (!chosen.length && !state.freeSelections.length) {
      $('#review-live-status').textContent = 'Select a suggested detail or draw an area before applying redactions.';
      showToast('Select a suggested detail or draw an area first.');
      return;
    }
    chosen.forEach(function (entity) {
      entity.redacted = true;
      entity.selected = false;
    });
    state.freeSelections.forEach(function (selection) { selection.redacted = true; });
    const count = state.entities.filter(function (entity) { return entity.redacted; }).length;
    state.redactionApplied = true;
    $('#review-live-status').textContent = chosen.length
      ? `${count} details masked. Review your selections, then finish redaction.`
      : state.entities.length ? 'No new suggestions selected. You can still finish this review.' : 'No editable suggestions were found. You can still finish this review.';
    renderReview();
    showToast(chosen.length
      ? `${chosen.length} ${chosen.length === 1 ? 'detail' : 'details'} masked.`
      : 'No new suggestions selected.');
  }

  function finishRedaction() {
    const finalCount = state.entities.filter(function (entity) { return entity.redacted; }).length;
    $('#result-file-name').textContent = state.filename.replace(/\.[^.]+$/, '') + '_redacted.html';
    $('#result-detected').textContent = String(state.entities.length);
    $('#result-redacted').textContent = String(finalCount);
    $('#result-time').innerHTML = '6 <small>min</small>';
    state.completionMode = state.tutorialActive ? 'tutorial-saving' : 'redaction';
    navigate('complete');
  }

  function downloadRedacted() {
    let output = state.sourceText;
    if (state.fileKind === 'sample' || state.fileKind === 'text') {
      const replacements = state.entities.map(function (entity) { return {
        start: Number.isInteger(entity.start) ? entity.start : state.sourceText.indexOf(entity.value),
        value: entity.value,
        redacted: entity.redacted
      }; }).filter(function (item) { return item.redacted && item.start >= 0; }).sort(function (first, second) { return second.start - first.start; });
      for (const replacement of replacements) {
        output = output.slice(0, replacement.start) + '[REDACTED]' + output.slice(replacement.start + replacement.value.length);
      }
    } else {
      output = `${state.filename}\n\nThis local prototype previews uploaded PDF/image files but does not alter their binary contents.\nRedacted details: ${state.entities.filter(function (entity) { return entity.redacted; }).length}.\nUse the fictional sample document to download a redacted text representation.`;
    }
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Redacted municipal document</title><style>body{max-width:760px;margin:48px auto;padding:0 24px;color:#292830;font:15px/1.8 system-ui,sans-serif}pre{white-space:pre-wrap;font:inherit}</style><h1>Redacted municipal document</h1><p>Generated locally by the ElinarAI prototype. Fictional demonstration data.</p><pre>${escapeHtml(output)}</pre></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = state.filename.replace(/\.[^.]+$/, '') + '_redacted.html';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('Your redacted document has been downloaded.');
  }

  function detectAndReview(text, filename) {
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = '';
    state.sourceText = text;
    state.filename = filename;
    state.fileKind = 'text';
    state.entities = detectTextEntities(text);
    state.entities.push(...createWordEntities(text, state.entities));
    state.filters = new Set(Object.keys(categoryLabels));
    state.selectionMode = false;
    $('#selection-mode').setAttribute('aria-pressed', 'false');
    $('#final-redact').textContent = 'Apply Redactions';
    delete $('#final-redact').dataset.confirm;
    const suggestionCount = state.entities.filter(isSuggestion).length;
    $('#review-live-status').textContent = suggestionCount
      ? `${suggestionCount} suggestions found. Review them before redacting.`
      : 'No sensitive text detected. You can still inspect this document.';
    navigate('review');
    if (state.tutorialActive) state.reachedSteps.add('demo');
    renderReview();
    if (state.tutorialActive) showGuideStep(0);
    if (!state.entities.length) showToast('No supported sensitive details were detected in this text file.');
  }

  function loadFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      showToast('Please choose a file smaller than 20 MB.');
      return;
    }
    const extension = file.name.split('.').pop().toLowerCase();
    if (['txt', 'md', 'csv'].includes(extension) || file.type.startsWith('text/')) {
      const reader = new FileReader();
      reader.addEventListener('load', function () { detectAndReview(String(reader.result || ''), file.name); });
      reader.addEventListener('error', function () { showToast('This text file could not be opened.'); });
      reader.readAsText(file);
      return;
    }
    if (file.type === 'application/pdf' || extension === 'pdf') {
      state.fileKind = 'pdf';
    } else if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
      state.fileKind = 'image';
    } else {
      showToast('Choose a PDF, image, or text document.');
      return;
    }
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = URL.createObjectURL(file);
    state.filename = file.name;
    state.sourceText = '';
    state.entities = [];
    state.sourceIsEditable = false;
    $('#review-live-status').textContent = 'Local preview ready. Upload a text file to review editable suggestions.';
    navigate('review');
    if (state.tutorialActive) state.reachedSteps.add('demo');
    renderReview();
    if (state.tutorialActive) showGuideStep(0);
    showToast('File previewed on this device. PDF and image content is not uploaded.');
  }

  function resetWorkflowState() {
    hideToolClarification();
    window.clearTimeout(state.transitionTimer);
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = '';
    state.entities = [];
    state.sourceText = '';
    state.filename = 'Municipal_Application.pdf';
    state.fileKind = 'text';
    state.filters = new Set(Object.keys(categoryLabels));
    state.selectionMode = false;
    state.freeSelectionMode = false;
    state.freeSelections = [];
    state.sourceIsEditable = true;
    state.tutorialRedacted = false;
    state.tutorialRedactedOnce = false;
    state.redactionApplied = false;
    state.guideIndex = -1;
    state.completionMode = '';
    state.realToolActive = false;
    state.tutorialActive = false;
    state.reachedSteps = new Set();
    $('#document-upload').value = '';
    $('#final-redact').textContent = 'Apply Redactions';
    $('#final-redact').disabled = false;
    delete $('#final-redact').dataset.confirm;
    $('#finish-redaction').hidden = true;
    $('#selection-mode').setAttribute('aria-pressed', 'false');
    $('#selection-mode').textContent = 'Word selection';
    $('#filter-menu').hidden = true;
    $('#filter-toggle').setAttribute('aria-expanded', 'false');
    $('#filter-toggle').classList.remove('is-open');
    updateFilterMenu();
    $('#review-live-status').textContent = 'Ready for your review.';
    if ($('#guide-callout')) closeGuide();
  }

  function resetForNewDocument() {
    resetWorkflowState();
    state.realToolActive = true;
    navigate('demo');
    renderUploadScreen();
  }

  function togglePopover(button, popover) {
    const willOpen = popover.hidden;
    popover.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
  }

  function toggleAssistant() {
    const chat = $('#chat-window');
    const open = $('#assistant-dock').hidden || chat.hidden;
    chat.hidden = !open;
    $('#assistant-notification').hidden = !open;
    $('#assistant-dock').hidden = !open;
    $('#help-button').setAttribute('aria-expanded', String(open));
    if (open) {
      positionAssistantDock();
      state.notificationSeen = true;
      $('#chat-notification-badge').hidden = true;
      $('#chat-input').focus();
    }
  }

  function positionAssistantDock() {
    const dock = $('#assistant-dock');
    if (dock.hidden) return;
    const trigger = $('#help-button').getBoundingClientRect();
    dock.style.top = `${trigger.bottom + 8}px`;
    dock.style.right = `${Math.max(12, window.innerWidth - trigger.right)}px`;
    dock.style.bottom = 'auto';
  }

  function addChatMessage(text, kind) {
    const message = document.createElement('p');
    message.className = `chat-message chat-message-${kind}`;
    message.textContent = text;
    const messages = $('#chat-messages');
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
  }

  function respondToChat(question) {
    const normalized = question.toLowerCase();
    if (normalized.includes('privacy') || normalized.includes('upload') || normalized.includes('local')) {
      return 'Your files stay in this browser in the demo. Nothing is uploaded to a server.';
    }
    if (normalized.includes('redact') || normalized.includes('mask')) {
      return 'Review the highlighted suggestions, select the details you want to protect, then choose Apply Redactions.';
    }
    if (normalized.includes('tutorial') || normalized.includes('next') || normalized.includes('step')) {
      return 'Use the Back and Next buttons to move through the tutorial. You can also select completed steps in the progress bar.';
    }
    return 'I can help with the tutorial, redaction steps and privacy. Try asking about one of those topics.';
  }

  function handleChatSubmit(event) {
    event.preventDefault();
    const input = $('#chat-input');
    const question = input.value.trim();
    if (!question) return;
    addChatMessage(question, 'user');
    input.value = '';
    window.setTimeout(function () { addChatMessage(respondToChat(question), 'assistant'); }, 250);
  }

  function handleClick(event) {
    const target = event.target.closest('button');
    if (!target) return;

    if (target.matches('[data-go-home]')) {
      goHome();
    } else if (target.matches('[data-action="back-home"]')) {
      goHome();
    } else if (target.matches('[data-action="start-tutorial"]')) {
      $('#assistant-dock').hidden = true;
      $('#chat-window').hidden = true;
      $('#assistant-notification').hidden = true;
      $('#help-button').setAttribute('aria-expanded', 'false');
      startTutorialTransition();
      showAssistantTip();
    } else if (target.matches('[data-action="use-tool"]')) {
      startRealTool();
    } else if (target.matches('[data-action="start-demo"]')) {
      startGuidedTour();
    } else if (target.matches('[data-action="go-tutorial"]')) {
      state.tutorialActive = true;
      state.realToolActive = false;
      renderTutorial();
      navigate('tutorial');
    } else if (target.matches('[data-action="go-why"]')) {
      navigate('why');
    } else if (target.matches('[data-action="go-demo"]')) {
      navigate('demo');
      renderUploadScreen();
    } else if (target.matches('[data-action="go-review"]')) {
      navigate('review');
      renderReview();
      if (state.tutorialActive && state.completionMode === 'tutorial-saving') showGuideStep(guideSteps.length - 1);
    } else if (target.matches('[data-action="browse-files"]')) {
      $('#document-upload').click();
    } else if (target.matches('[data-action="use-demo-sample"]')) {
      loadGuidedSample();
    } else if (target.matches('[data-action="start-another"]')) {
      resetForNewDocument();
    } else if (target.matches('[data-action="back-to-why"]')) {
      if (state.tutorialActive) navigate('why');
    } else if (target.matches('[data-step]')) {
      if (target.dataset.step === 'tutorial') renderTutorial();
      navigate(target.dataset.step);
      if (target.dataset.step === 'demo') renderUploadScreen();
    } else if (target.id === 'tutorial-redact') {
      if (target.classList.contains('is-processing')) return;
      target.classList.add('is-processing');
      $('.tutorial-viewer').classList.add('is-redacting');
      window.setTimeout(function () {
        target.classList.remove('is-processing');
        $('.tutorial-viewer').classList.remove('is-redacting');
        state.tutorialRedacted = !state.tutorialRedacted;
        if (state.tutorialRedacted) state.tutorialRedactedOnce = true;
        renderTutorial();
        showToast(state.tutorialRedacted ? 'Sensitive details have been redacted.' : 'Redactions have been undone.');
      }, 500);
    } else if (target.id === 'tutorial-next') {
      if (!state.tutorialRedactedOnce) return;
      state.reachedSteps.add('why');
      navigate('why');
    } else if (target.id === 'info-button') {
      togglePopover(target, $('#info-popover'));
    } else if (target.id === 'help-button') {
      toggleAssistant();
    } else if (target.id === 'guide-back') {
      showGuideStep(state.guideIndex - 1);
    } else if (target.id === 'guide-next') {
      showGuideStep(state.guideIndex + 1);
    } else if (target.id === 'guide-close') {
      state.guideDismissed = true;
      closeGuide();
    } else if (target.matches('[data-page-action]')) {
      const viewer = target.closest('.paper-viewer');
      const currentPage = Number(viewer.dataset.page || 1);
      setDocumentPage(viewer, currentPage + (target.dataset.pageAction === 'next' ? 1 : -1));
      if (viewer.classList.contains('tutorial-viewer')) {
        state.tutorialPage = Number(viewer.dataset.page || 1);
        renderTutorial();
      }
    } else if (target.id === 'finish-redaction') {
      finishRedaction();
    } else if (target.matches('[data-action="finish-tutorial"]')) {
      finishTutorialSave();
    } else if (target.matches('[data-action="back-to-tour"]')) {
      state.completionMode = 'tutorial-saving';
      state.redactionApplied = true;
      navigate('complete');
    } else if (target.id === 'chat-close') {
      $('#assistant-dock').hidden = true;
      $('#chat-window').hidden = true;
      $('#assistant-notification').hidden = true;
      $('#help-button').setAttribute('aria-expanded', 'false');
    } else if (target.id === 'notification-close') {
      $('#assistant-notification').hidden = true;
      if ($('#chat-window').hidden) $('#assistant-dock').hidden = true;
    } else if (target.id === 'mask-all') {
      const matches = getSearchMatches();
      const targets = getSearchTargets();
      if (!matches.length) {
        showToast('Search for a word or phrase first.');
        return;
      }
      targets.forEach(function (entity) {
        entity.selected = true;
        entity.redacted = false;
      });
      renderReview();
      $('#review-live-status').textContent = 'Every occurrence matching your search is selected for redaction.';
      showToast(`${targets.length} matching occurrence${targets.length === 1 ? '' : 's'} selected.`);
    } else if (target.id === 'unmask-all') {
      const matches = getSearchMatches();
      const targets = getSearchTargets();
      if (!matches.length) {
        showToast('Search for a word or phrase first.');
        return;
      }
      targets.forEach(function (entity) {
        entity.selected = false;
        entity.redacted = false;
      });
      renderReview();
      $('#review-live-status').textContent = 'Every occurrence matching your search is unselected.';
      showToast(`${targets.length} matching occurrence${targets.length === 1 ? '' : 's'} unselected.`);
    } else if (target.id === 'selection-mode') {
      state.selectionMode = !state.selectionMode;
      state.freeSelectionMode = false;
      state.dragStart = null;
      state.dragBox = null;
      target.setAttribute('aria-pressed', String(state.selectionMode));
      target.textContent = state.selectionMode ? 'Word selection on' : 'Word selection';
      $('#free-selection').setAttribute('aria-pressed', 'false');
      $('#review-paper-scroll').classList.toggle('is-selecting', state.selectionMode);
      $('#review-hint').innerHTML = state.selectionMode
        ? '<span aria-hidden="true">⌖</span> Select details directly in the document.'
        : '<span aria-hidden="true">⌁</span> Turn on Direct selection to choose highlights in the document; the sidebar is always available.';
      $('#review-live-status').textContent = state.selectionMode ? 'Selection mode on. Choose details to redact.' : 'Selection mode off.';
    } else if (target.id === 'free-selection') {
      state.freeSelectionMode = !state.freeSelectionMode;
      state.selectionMode = false;
      state.dragStart = null;
      state.dragBox = null;
      target.setAttribute('aria-pressed', String(state.freeSelectionMode));
      $('#selection-mode').setAttribute('aria-pressed', 'false');
      $('#selection-mode').textContent = 'Word selection';
      $('#selection-mode').textContent = 'Word selection';
      $('#review-paper-scroll').classList.toggle('is-free-selecting', state.freeSelectionMode);
      $('#review-live-status').textContent = state.freeSelectionMode ? 'Free selection on. Draw an area to redact.' : 'Free selection off.';
    } else if (target.id === 'zoom-in') {
      state.zoom = Math.min(1.5, state.zoom + .1);
      $('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
      renderReview();
    } else if (target.id === 'zoom-out') {
      state.zoom = Math.max(.7, state.zoom - .1);
      $('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
      renderReview();
    } else if (target.id === 'review-page-prev' || target.id === 'review-page-next') {
      const viewer = $('.review-viewer');
      const currentPage = Number(viewer.dataset.page || 1);
      setDocumentPage(viewer, currentPage + (target.id === 'review-page-next' ? 1 : -1));
      updateReviewPageControls();
    } else if (target.id === 'document-search') {
      updateSearch(target.value);
    } else if (target.id === 'find-selection') {
      const searchMatch = getSearchMatches()[0];
      const firstSelected = state.entities.find(function (entity) {
        return isSuggestion(entity) && entity.selected;
      });
      const targetEntity = searchMatch || firstSelected;
      if (!targetEntity) {
        showToast('Search for a word or select a suggested detail first.');
      } else {
        const index = state.entities.indexOf(targetEntity);
        const element = $(`[data-entity-index="${index}"]`, $('#review-paper'));
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element?.focus({ preventScroll: true });
        showToast(searchMatch
          ? `Showing ${searchMatch.value} in the document.`
          : `Showing ${categoryLabels[targetEntity.category].toLowerCase()} in the document.`);
      }
    } else if (target.id === 'filter-toggle') {
      togglePopover(target, $('#filter-menu'));
      target.classList.toggle('is-open', !$('#filter-menu').hidden);
    } else if (target.id === 'clear-filters') {
      state.filters = new Set(Object.keys(categoryLabels));
      updateFilterMenu();
      renderReview();
    } else if (target.id === 'select-all-suggestions') {
      const suggestions = state.entities.filter(isSuggestion);
      const allSelected = suggestions.length > 0 && suggestions.every(function (entity) { return entity.selected; });
      suggestions.forEach(function (entity) { entity.selected = !allSelected; });
      $('#review-live-status').textContent = allSelected
        ? 'Suggestions deselected from review.'
        : `${suggestions.length} suggestions selected for review.`;
      renderReview();
    } else if (target.id === 'final-redact') {
      if (state.tutorialActive && state.guideIndex === guideSteps.length - 1) closeGuide();
      redactSelected();
    } else if (target.id === 'download-document') {
      downloadRedacted();
    } else if (target.matches('[data-entity-index]')) {
      if (state.didDrag) {
        state.didDrag = false;
        return;
      }
      const index = Number(target.dataset.entityIndex);
      const entity = state.entities[index];
      if (!entity) return;
      if (target.closest('#review-paper') && !state.selectionMode) {
        showToast('Turn on Direct selection to choose details in the document.');
        return;
      }
      if (entity.redacted) {
        entity.redacted = false;
        entity.selected = true;
      } else {
        entity.selected = !entity.selected;
      }
      $('#final-redact').textContent = 'Redact';
      delete $('#final-redact').dataset.confirm;
      $('#review-live-status').textContent = `${state.entities.filter(function (item) { return item.selected; }).length} suggestions selected for review.`;
      renderReview();
    }
  }

  function handleChange(event) {
    if (event.target.id === 'document-upload') {
      loadFile(event.target.files[0]);
    } else if (event.target.matches('#filter-options input')) {
      const category = event.target.value;
      if (event.target.checked) state.filters.add(category);
      else state.filters.delete(category);
      renderReview();
      updateFilterMenu();
    }
  }

  function handleInput(event) {
    if (event.target.id === 'document-search') updateSearch(event.target.value);
  }

  function initializeReviewSelection() {
    const scroll = $('#review-paper-scroll');
    scroll.addEventListener('pointerdown', function (event) {
      if (!state.selectionMode && !state.freeSelectionMode) return;
      if (!event.target.closest('#review-paper')) return;
      const paperRect = $('#review-paper').getBoundingClientRect();
      const x = Math.max(paperRect.left, Math.min(event.clientX, paperRect.right));
      const y = Math.max(paperRect.top, Math.min(event.clientY, paperRect.bottom));
      state.dragStart = { x: (x - paperRect.left) / state.zoom, y: (y - paperRect.top) / state.zoom };
      state.dragButton = event.button;
      state.didDrag = false;
      scroll.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    scroll.addEventListener('pointermove', updateDragBox);
    scroll.addEventListener('pointerup', finishDrag);
    scroll.addEventListener('pointercancel', finishDrag);
    scroll.addEventListener('contextmenu', function (event) {
      if (state.selectionMode || state.freeSelectionMode) event.preventDefault();
    });
  }

  function initializeDropZone() {
    const zone = $('#upload-zone');
    ['dragenter', 'dragover'].forEach(function (type) { zone.addEventListener(type, function (event) {
      event.preventDefault();
      zone.classList.add('is-dragging');
    }); });
    ['dragleave', 'drop'].forEach(function (type) { zone.addEventListener(type, function (event) {
      event.preventDefault();
      zone.classList.remove('is-dragging');
    }); });
    zone.addEventListener('drop', function (event) { loadFile(event.dataTransfer.files[0]); });
  }

  function initialize() {
    $('.completion-actions [data-action="start-another"]')?.remove();
    const tutorialControls = $('.tutorial-controls');
    if (!$('.tutorial-home-back')) {
      const homeButton = document.createElement('button');
      homeButton.className = 'button button-quiet tutorial-home-back';
      homeButton.type = 'button';
      homeButton.dataset.action = 'back-home';
      homeButton.textContent = 'Back';
      tutorialControls.prepend(homeButton);
    }
    if (!$('.upload-home-back')) {
      const homeButton = document.createElement('button');
      homeButton.className = 'button button-quiet upload-home-back';
      homeButton.type = 'button';
      homeButton.dataset.action = 'back-home';
      homeButton.textContent = 'Back';
      $('.screen-footer', $('[data-screen="demo"]')).prepend(homeButton);
    }
    if (!$('#guide-close')) {
      const closeButton = document.createElement('button');
      closeButton.className = 'button button-secondary';
      closeButton.id = 'guide-close';
      closeButton.type = 'button';
      closeButton.textContent = 'Close';
      $('.guide-controls').append(closeButton);
    }
    $$('.ai-comparison').forEach(function (section) {
      if (section.querySelector('.ai-term-wrap')) section.remove();
    });
    $$('.ai-comparison').forEach(function (section) {
      section.removeAttribute('aria-labelledby');
      section.setAttribute('aria-label', 'A different kind of AI');
      const comparisonHeading = $('.ai-comparison-heading', section);
      if (comparisonHeading) {
        comparisonHeading.innerHTML = '<span class="eyebrow">A DIFFERENT KIND OF AI</span>';
      }
      const grid = $('.ai-comparison-grid', section);
      const firstPanel = $('.ai-type', grid);
      if (grid && firstPanel && !$('.ai-comparison-vs', grid)) {
        const divider = document.createElement('span');
        divider.className = 'ai-comparison-vs';
        divider.setAttribute('aria-hidden', 'true');
        divider.textContent = '≠';
        grid.insertBefore(divider, firstPanel.nextElementSibling);
      }
      const description = $('.ai-type-descriptive .ai-detail', section);
      const descriptiveHeading = $('.ai-type-descriptive .ai-type-heading span:last-child', section);
      const generativeHeading = $('.ai-type-generative .ai-type-heading span:last-child', section);
      if (descriptiveHeading) descriptiveHeading.textContent = 'Elinar AI Model';
      if (generativeHeading) generativeHeading.textContent = 'ChatGPT AI Model';
      if (description) description.textContent = 'The AI used by Elinar for Redact is Descriptive AI. Descriptive AI examines already existing data. Your data is safe, because the AI does not understand it. It simply identifies patterns and highlights them. It observes and analyzes existing information rather than generating new content.';
      const generativeDescription = $('.ai-type-generative .ai-detail', section);
      if (generativeDescription) generativeDescription.textContent = 'The AI used by ChatGPT is Generative AI. Generative AI creates new content based on instructions, such as text, images or summaries. Generated content is often out of human control and can make mistakes without notifying humans, as it can improvise.';
      if (section === $$('.ai-comparison').find(function (item) { return item.querySelector('.ai-diagram'); })) {
        section.querySelector('.ai-type-descriptive')?.classList.add('ai-type-elinar');
      }
    });
    $('#why-title').textContent = 'About Elinar';
    $$('.benefit-list li').forEach(function (item, index) {
      const copy = item.querySelector('span:nth-child(2)');
      if (!copy) return;
      copy.textContent = [
        'A little less work, a lot more time — save around 6 minutes per page.',
        'Your documents are handled securely and regularly deleted, so your data does not stay in the system longer than necessary.',
        'Choose the filters that work best for you and easily tailor redaction to your needs.',
        'Need a hand? Help is available 24/7. Just click the icon in the top-right corner.',
        'Redact does the heavy lifting, but you make the final call. Nothing is redacted without your approval.'
      ][index];
    });
    const logos = $('.organization-logos');
    if (logos && !$('.aigine-wordmark', logos)) {
      const aigine = document.createElement('span');
      aigine.className = 'aigine-wordmark';
      aigine.setAttribute('aria-label', 'Aigine');
      aigine.textContent = 'AIGINE';
      logos.append(aigine);
    }
    const aiComparison = $$('.ai-comparison').find(function (section) { return section.querySelector('.ai-diagram'); });
    if (aiComparison && !$('.trust-section')) {
      const trust = document.createElement('section');
      trust.className = 'trust-section';
      trust.innerHTML = '<span class="eyebrow">SAFETY</span><h2>Built for responsible data handling</h2><ol><li>ElinarAI aligns with <strong>European data protection policies</strong>, specifically being designed to operate as a GDPR-compliant solution for discovering and handling personal data.</li><li>No persistent storing of sensitive discoveries: during personal data discovery, data is run through the AI without being permanently saved by the AI model itself, which <strong>protects user data security</strong>.</li><li>Flexible deployment options: it is available via secure cloud infrastructures, such as Elinar\'s cloud or IBM Cloud, or as a secure on-site deployment to match <strong>strict data sovereignty requirements</strong>.</li></ol>';
      aiComparison.after(trust);
    }
    const uploadMain = $('.upload-main');
    const sampleLink = $('#demo-sample-document');
    const uploadZone = $('#upload-zone');
    if (uploadMain && sampleLink && uploadZone) {
      uploadMain.insertBefore(sampleLink, uploadZone);
      const sampleTitle = sampleLink.querySelector('strong');
      if (sampleTitle) sampleTitle.textContent = 'Upload sample municipal document';
    }
    initializeLogos();
    createProgress();
    buildReviewToolbar();
    initializePageControls();
    updateFilterMenu();
    renderProgress();
    renderTutorial();
    $('.app-shell').classList.add('is-home');
    $('#chat-notification-badge').hidden = false;
    state.tutorialActive = false;
    playHomeIntro();
    document.addEventListener('click', handleClick);
    document.addEventListener('mouseover', function (event) {
      if (state.realToolActive && state.screen === 'review') {
        scheduleToolClarification(event.target);
        return;
      }
      if (!state.guideDismissed || !state.tutorialActive || state.screen !== 'review') return;
      if (event.relatedTarget?.closest && event.relatedTarget.closest('#guide-callout')) return;
      const target = event.target.closest(guideSteps.map(function (step) { return step.target; }).join(','));
      if (!target) return;
      const index = guideSteps.findIndex(function (step) { return target.matches(step.target); });
      if (index >= 0) showGuideStep(index, true);
    });
    document.addEventListener('mouseout', function (event) {
      if (state.realToolActive && state.screen === 'review') {
        const target = event.target.closest(guideSteps.map(function (step) { return step.target; }).join(','));
        const related = event.relatedTarget;
        if (target && (!related || !target.contains(related))) hideToolClarification();
        return;
      }
      if (!state.guideHoverOnly || event.relatedTarget?.closest?.('#guide-callout')) return;
      const target = event.target.closest(guideSteps.map(function (step) { return step.target; }).join(','));
      if (target) closeGuide();
    });
    $('#guide-callout').addEventListener('mouseleave', function () {
      if (state.guideHoverOnly) closeGuide();
    });
    document.addEventListener('change', handleChange);
    document.addEventListener('input', handleInput);
    window.addEventListener('scroll', positionGuideCallout, true);
    window.addEventListener('scroll', positionAssistantDock, true);
    window.addEventListener('resize', positionGuideCallout);
    window.addEventListener('resize', function () {
      if (state.clarificationTarget && !$('#tool-clarification').hidden) {
        const target = state.clarificationTarget;
        const step = guideSteps.find(function (item) { return target.matches(item.target); });
        if (step) showToolClarification(target, step);
      }
    });
    window.addEventListener('resize', positionAssistantDock);
    $('#chat-form').addEventListener('submit', handleChatSubmit);
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.info-wrap') && !$('#info-popover').hidden) {
        $('#info-popover').hidden = true;
        $('#info-button').setAttribute('aria-expanded', 'false');
      }
      if (!event.target.closest('.filter-wrap') && !$('#filter-menu').hidden) {
        $('#filter-menu').hidden = true;
        $('#filter-toggle').setAttribute('aria-expanded', 'false');
        $('#filter-toggle').classList.remove('is-open');
      }
    });
    initializeDropZone();
    initializeReviewSelection();
  }

  initialize();
}());