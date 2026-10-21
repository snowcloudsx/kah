(function () {
    'use strict';
    console.log('[KaHoax] SCRIPT LOADED');
    const Version = '2.0';
    const PROXY = 'https://damp-leaf-16aa.johnwee.workers.dev';

    let questions = [];
    let questionTexts = [];
    let questionChoices = [];
    const info = { numQuestions: 0, questionNum: -1, lastAnsweredQuestion: -1, ILSetQuestion: -1 };
    let PPT = 900, Answered_PPT = 900, autoAnswer = true, showAnswers = true, inputLag = 100;
    let lastValidQuizID = null, isAutoSearching = false;
    let networkQuizId = null;
    let answeredThisRound = false;
    let detectionFailed = false;
    let stopped = false;

    function log(msg) { try { console.log('[KaHoax]', msg); } catch (e) {} }

    function FindByAttributeValue(attribute, value, element_type) {
        element_type = element_type || '*';
        const All = document.getElementsByTagName(element_type);
        for (let i = 0; i < All.length; i++) if (All[i].getAttribute(attribute) == value) return All[i];
    }

    function detectQuizIdFromGlobals() {
        log('detectQuizIdFromGlobals()');
        if (networkQuizId && isValidGameId(networkQuizId)) { log('found via network: ' + networkQuizId); return networkQuizId; }
        // localStorage game session
        try {
            const raw = localStorage.getItem('kahoot-game_session');
            if (raw) {
                const obj = JSON.parse(raw);
                const candidates = [];
                if (obj.trainingContentId) candidates.push(String(obj.trainingContentId).split('_')[0]);
                if (obj.gameApiId) candidates.push(String(obj.gameApiId));
                for (let i = 0; i < candidates.length; i++) {
                    if (isValidGameId(candidates[i])) { log('found via localStorage: ' + candidates[i]); return candidates[i]; }
                }
            }
        } catch (e) {}
        const paths = [
            function () { return window.kahoot && window.kahoot.gameBlock && window.kahoot.gameBlock.quizId; },
            function () { return window.kahoot && window.kahoot.gameBlock && window.kahoot.gameBlock.quiz && window.kahoot.gameBlock.quiz.uuid; },
            function () { return window.kahoot && window.kahoot.quizId; },
            function () { return window.kahoot && window.kahoot.quiz && window.kahoot.quiz.uuid; },
            function () { return window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps && window.__NEXT_DATA__.props.pageProps.quizId; },
            function () { return window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps && window.__NEXT_DATA__.props.pageProps.gameBlock && window.__NEXT_DATA__.props.pageProps.gameBlock.quizId; },
            function () { return window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps && window.__NEXT_DATA__.props.pageProps.kahoot && window.__NEXT_DATA__.props.pageProps.kahoot.uuid; },
            function () { return window.__KAHOOT_STATE__ && window.__KAHOOT_STATE__.quizId; },
            function () { return window.__KAHOOT_STATE__ && window.__KAHOOT_STATE__.quiz && window.__KAHOOT_STATE__.quiz.uuid; },
            function () { return window.appState && window.appState.quizId; }
        ];
        for (let i = 0; i < paths.length; i++) {
            try {
                const v = paths[i]();
                if (v && isValidGameId(String(v))) return String(v);
            } catch (e) {}
        }
        // scan script tags for quizId/uuid
        try {
            const scripts = document.querySelectorAll('script');
            for (let i = 0; i < scripts.length; i++) {
                const txt = scripts[i].textContent || '';
                let m = txt.match(/"quizId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
                if (m) return m[1];
                m = txt.match(/"uuid"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
                if (m) return m[1];
            }
        } catch (e) {}
        return null;
    }
    function sanitizeInput(val) {
        val = val.trim();
        if (val.indexOf('https//') === 0) val = val.replace('https//', 'https://');
        if (/^https?:\/\//i.test(val)) {
            const parts = val.replace(/^https?:\/\//i, '').split('/');
            return parts.filter(Boolean).pop();
        }
        return val;
    }

    function isValidGameId(str) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    }

    function getQuestionText() {
        const sels = [
            '[data-functional-selector="block-title"]',
            '[data-functional-selector="question-title"]',
            '[data-functional-selector="question-title-text"]',
            '[class*="question-title"]',
            '[class*="QuestionTitle"]',
            '[class*="question-text"]',
            '[class*="QuestionText"]',
            '[class*="title-text"]',
            '[class*="TitleText"]',
            '[class*="block-text"]',
            '[class*="BlockText"]',
            '.question-title__Title-sc-12qj0yr-1'
        ];
        for (let i = 0; i < sels.length; i++) {
            try {
                const els = document.querySelectorAll(sels[i]);
                for (let j = 0; j < els.length; j++) {
                    const t = (els[j].textContent || '').trim();
                    if (t && t.length > 3 && t.length < 500) return t;
                }
            } catch (e) {}
        }
        try {
            const candidates = document.querySelectorAll('p, div, span, h1, h2, h3, h4');
            for (let i = 0; i < candidates.length; i++) {
                const el = candidates[i];
                if (!el.offsetParent || el.offsetWidth < 100) continue;
                if (el.children.length > 5) continue;
                const t = (el.textContent || '').trim();
                if (t && t.length > 10 && t.length < 500) {
                    if (t.indexOf('?') !== -1 || t.indexOf('___') !== -1 || t.indexOf('...') !== -1) return t;
                }
            }
        } catch (e) {}
        return null;
    }

    function getQuestionNumberFromDOM() {
        try {
            const els = document.querySelectorAll('*');
            for (let i = 0; i < els.length; i++) {
                const t = (els[i].textContent || '').trim();
                let m = t.match(/Question\s*(\d+)\s*of\s*(\d+)/i);
                if (m) return +m[1] - 1;
                m = t.match(/^(\d+)\s*Question/i);
                if (m) return +m[1] - 1;
            }
        } catch (e) {}
        const tm = (document.title || '').match(/Quiz,\s*(\d+)\s*of\s*(\d+)/i);
        if (tm) return +tm[1] - 1;
        return null;
    }
    function parseQuestions(questionsJson) {
        let out = [];
        (questionsJson || []).forEach(function (question) {
            let q = { type: question.type, time: question.time };
            if (['quiz', 'multiple_select_quiz'].includes(question.type)) {
                let i = 0;
                q.answers = [];
                q.incorrectAnswers = [];
                (question.choices || []).forEach(function (choice) {
                    if (choice.correct) q.answers.push(i); else q.incorrectAnswers.push(i);
                    i++;
                });
            }
            if (question.type === 'open_ended') {
                q.answers = [];
                (question.choices || []).forEach(function (choice) { q.answers.push(choice.answer); });
            }
            out.push(q);
        });
        return out;
    }

    // --- Network interception to capture quiz id ---
    function scanTextForQuizId(txt) {
        if (networkQuizId) return;
        if (!txt) return;
        let m = txt.match(/"quizId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
        if (m) { networkQuizId = m[1]; console.log('[KaHoax] network scan found quizId: ' + m[1]); return; }
        m = txt.match(/"uuid"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
        if (m) { networkQuizId = m[1]; }
    }
    function scanUrlForQuizId(url) {
        if (networkQuizId || !url) return;
        const m = String(url).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (m) { networkQuizId = m[1]; console.log('[KaHoax] url scan found uuid: ' + m[1]); }
    }
    try {
        const origFetch = window.fetch;
        if (origFetch) {
            window.fetch = function () {
                try { scanUrlForQuizId(arguments[0] && (typeof arguments[0] === 'string' ? arguments[0] : arguments[0].url)); } catch (e) {}
                const p = origFetch.apply(this, arguments);
                if (p && typeof p.then === 'function') {
                    p.then(function (res) {
                        try {
                            const c = res.clone();
                            c.text().then(scanTextForQuizId).catch(function () {});
                        } catch (e) {}
                        return res;
                    }).catch(function () {});
                }
                return p;
            };
        }
    } catch (e) {}
    try {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._kh_url = url;
            return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            try { scanUrlForQuizId(this._kh_url); } catch (e) {}
            this.addEventListener('load', function () {
                try { scanTextForQuizId(this.responseText); } catch (e) {}
            });
            return origSend.apply(this, arguments);
        };
    } catch (e) {}

    // --- WebSocket interception ---
    try {
        const OrigWS = window.WebSocket;
        if (OrigWS) {
            function WrappedWebSocket(url, protocols) {
                const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
                try { scanUrlForQuizId(url); } catch (e) {}
                ws.addEventListener('message', function (e) {
                    try { scanTextForQuizId(typeof e.data === 'string' ? e.data : ''); } catch (err) {}
                });
                return ws;
            }
            WrappedWebSocket.prototype = OrigWS.prototype;
            WrappedWebSocket.CONNECTING = OrigWS.CONNECTING;
            WrappedWebSocket.OPEN = OrigWS.OPEN;
            WrappedWebSocket.CLOSING = OrigWS.CLOSING;
            WrappedWebSocket.CLOSED = OrigWS.CLOSED;
            window.WebSocket = WrappedWebSocket;
        }
    } catch (e) {}
    const ui = document.createElement('div');
    ui.id = 'kahox-ui';
    ui.style.cssText = 'position:fixed;top:5%;left:5%;width:320px;max-width:90vw;background:#1e1e1e;border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,.5);z-index:9999;font-size:14px;color:#fff;font-family:Montserrat,Helvetica,Arial,sans-serif;overflow:auto;max-height:90vh;';
    const handle = document.createElement('div');
    handle.style.cssText = 'height:36px;line-height:36px;padding-left:12px;background:#2c2c2c;border-radius:10px 10px 0 0;cursor:grab;display:flex;align-items:center;';
    handle.textContent = 'KaHoax ' + Version;
    ui.appendChild(handle);

    const body = document.createElement('div');
    body.style.padding = '12px';
    ui.appendChild(body);

    function row(label, el) { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:6px 0;'; const s = document.createElement('span'); s.textContent = label; d.appendChild(s); d.appendChild(el); return d; }

    const status = document.createElement('div');
    status.style.cssText = 'text-align:center;margin:6px 0;font-size:12px;opacity:.8;';
    status.textContent = 'Idle';
    body.appendChild(status);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Quiz ID (auto-detects)';
    input.style.cssText = 'width:100%;height:30px;margin:6px 0;padding:0 8px;border:1px solid #444;border-radius:6px;background:#333;color:#fff;text-align:center;box-sizing:border-box;';
    body.appendChild(input);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;margin:6px 0;';
    const enterBtn = document.createElement('button');
    enterBtn.textContent = 'Load';
    enterBtn.style.cssText = 'flex:1;height:30px;border:none;border-radius:5px;background:#6c757d;color:#fff;cursor:pointer;';
    btnRow.appendChild(enterBtn);
    const scanBtn = document.createElement('button');
    scanBtn.textContent = 'Scan';
    scanBtn.style.cssText = 'flex:1;height:30px;border:none;border-radius:5px;background:#0088ff;color:#fff;cursor:pointer;';
    btnRow.appendChild(scanBtn);
    body.appendChild(btnRow);

    function makeToggle(label, initial, onChange) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = initial;
        cb.style.accentColor = '#4CAF50';
        cb.addEventListener('change', function () { onChange(cb.checked); });
        const span = document.createElement('span');
        span.textContent = label;
        wrap.appendChild(cb);
        wrap.appendChild(span);
        return { wrap, cb };
    }

    const t1 = makeToggle('Auto-answer', autoAnswer, function (v) { autoAnswer = v; });
    const t2 = makeToggle('Highlight answers', showAnswers, function (v) { showAnswers = v; });
    body.appendChild(t1.wrap);
    body.appendChild(t2.wrap);

    const qLabel = document.createElement('div');
    qLabel.style.cssText = 'text-align:center;margin:8px 0;font-size:12px;';
    qLabel.textContent = 'Question 0 / ?';
    body.appendChild(qLabel);

    const sliderWrap = document.createElement('div');
    sliderWrap.style.cssText = 'margin:8px 0;';
    const sliderLabel = document.createElement('div');
    sliderLabel.style.cssText = 'font-size:12px;margin-bottom:4px;';
    sliderLabel.textContent = 'Points per question: ~900';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '500'; slider.max = '1000'; slider.value = '900';
    slider.style.width = '100%';
    slider.addEventListener('input', function () { PPT = +slider.value; sliderLabel.textContent = 'Points per question: ~' + PPT; });
    sliderWrap.appendChild(sliderLabel);
    sliderWrap.appendChild(slider);
    body.appendChild(sliderWrap);

    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:0;right:0;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:#ff4d4d;border-radius:0 10px 0 0;cursor:pointer;';
    ui.appendChild(closeBtn);
    closeBtn.addEventListener('click', function () { stopped = true; autoAnswer = false; showAnswers = false; try { document.documentElement.removeChild(ui); } catch (e) {} console.log('[KaHoax] un.injected'); });

    // drag
    let dragging = false, ox, oy;
    handle.addEventListener('mousedown', function (e) { dragging = true; ox = e.clientX - ui.getBoundingClientRect().left; oy = e.clientY - ui.getBoundingClientRect().top; });
    document.addEventListener('mousemove', function (e) { if (dragging) { ui.style.left = (e.clientX - ox) + 'px'; ui.style.top = (e.clientY - oy) + 'px'; } });
    document.addEventListener('mouseup', function () { dragging = false; });

    // Re-apply highlight periodically in case DOM re-renders
    setInterval(function () {
        if (!showAnswers) return;
        const q = questions[info.questionNum];
        if (!q) return;
        const btns = getAnswerButtons();
        if (!btns.length) return;
        // only highlight if not already
        const already = btns.some(function (b) { return b.style.outline && b.style.outline.indexOf('22c55e') !== -1; });
        if (!already) {
            console.log('[KaHoax] re-applying highlight');
            highlightAnswers(q);
        }
    }, 500);
    console.log('[KaHoax] UI appended to body');
    function ensureUI() {
        if (!document.body) return;
        if (!document.getElementById('kahox-ui')) {
            console.log('[KaHoax] UI removed, re-appending');
            document.documentElement.appendChild(ui);
        }
    }
    setInterval(ensureUI, 1000);

    setInterval(function () {
        console.log('[KaHoax] status: qNum=' + info.questionNum + ' loadedQs=' + questions.length + ' autoSearch=' + isAutoSearching + ' netId=' + (networkQuizId || 'none'));
    }, 2000);

    // url auto-detect
    (function () {
        const m = window.location.href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (m) { input.value = m[0]; setTimeout(loadQuizInput, 300); }
    })();

    function loadQuizInput() {
        log('loadQuizInput: ' + input.value);
        const raw = input.value;
        const quizID = sanitizeInput(raw);
        const url = PROXY + '/api-proxy/' + encodeURIComponent(quizID);
        if (!quizID) return;
        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('fail');
            return r.json();
        }).then(function (data) {
            questions = parseQuestions(data.questions);
            questionTexts = (data.questions || []).map(function (q) { return q.question || q.title || ''; });
            questionChoices = (data.questions || []).map(function (q) { return (q.choices || []).map(function (c) { return c.answer || ''; }); });
            info.numQuestions = questions.length;
            lastValidQuizID = quizID;
            input.style.backgroundColor = 'green';
            status.textContent = 'Loaded: ' + (data.title || quizID);
        }).catch(function () {
            input.style.backgroundColor = 'red';
            status.textContent = 'Lookup failed, searching...';
            searchPublicUUID(quizID);
        });
    }
    enterBtn.addEventListener('click', loadQuizInput);
    scanBtn.addEventListener('click', function () { scanNow(); });

    function scanNow() {
        console.log('[KaHoax] === SCAN START ===');
        status.textContent = 'Scanning...';
        const nid = detectQuizIdFromGlobals();
        console.log('[KaHoax] detectQuizIdFromGlobals ->', nid);
        if (nid) {
            console.log('[KaHoax] quiz id found via detection: ' + nid);
            input.value = nid;
            loadQuizInput();
            return;
        }
        console.log('[KaHoax] no global/network id; trying question text search');
        const qt = getQuestionText();
        console.log('[KaHoax] question text: ' + (qt || 'NONE'));
        if (qt) {
            isAutoSearching = false;
            autoLoadByQuestion();
        } else {
            status.textContent = 'No question text found';
            console.log('[KaHoax] scan failed: no question text');
        }
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') loadQuizInput(); });

    function searchPublicUUID(searchTerm) {
        const url = PROXY + '/rest/kahoots/?query=' + encodeURIComponent(searchTerm);
        fetch(url).then(function (r) { return r.json(); }).then(function (data) {
            const results = (data.entities && data.entities.length > 0) ? data.entities : [];
            if (results.length > 0) {
                const uuid = results[0].card.uuid;
                input.value = uuid;
                loadQuizInput();
            } else {
                status.textContent = 'No results';
            }
        }).catch(function () { status.textContent = 'Search error'; });
    }

    function autoLoadByQuestion() {
        if (detectionFailed) { console.log('[KaHoax] auto-detect disabled (previous fail)'); return; }
        log('autoLoadByQuestion()');
        const detected = detectQuizIdFromGlobals();
        if (detected) {
            isAutoSearching = true;
            const detailUrl = PROXY + '/api-proxy/' + encodeURIComponent(detected);
            fetch(detailUrl).then(function (r) { if (!r.ok) throw new Error('not found'); return r.json(); }).then(function (d) {
                questions = parseQuestions(d.questions);
                questionTexts = (d.questions || []).map(function (q) { return q.question || q.title || ''; });
                questionChoices = (d.questions || []).map(function (q) { return (q.choices || []).map(function (c) { return c.answer || ''; }); });
                info.numQuestions = questions.length;
                lastValidQuizID = detected;
                input.value = detected;
                input.style.backgroundColor = 'green';
                status.textContent = 'Loaded: ' + (d.title || detected);
                isAutoSearching = false;
                onQuestionStart();
            }).catch(function () { detectionFailed = true; isAutoSearching = false; fallbackTextSearch(); });
            return;
        }
        fallbackTextSearch();
    }

    function fallbackTextSearch() {
        console.log('[KaHoax] fallbackTextSearch()');
        const qText = getQuestionText();
        if (!qText) { isAutoSearching = false; return; }
        isAutoSearching = true;
        status.textContent = 'Auto-detecting...';
        const url = PROXY + '/rest/kahoots/?query=' + encodeURIComponent(qText);
        fetch(url).then(function (r) { return r.json(); }).then(function (data) {
            const results = (data.entities && data.entities.length > 0) ? data.entities : [];
            if (!results.length) { isAutoSearching = false; detectionFailed = true; status.textContent = 'No match - enter quiz ID manually'; return; }
            const uuid = results[0].card.uuid;
            const detailUrl = PROXY + '/api-proxy/' + encodeURIComponent(uuid);
            return fetch(detailUrl).then(function (r) { return r.json(); }).then(function (d) {
                questions = parseQuestions(d.questions);
                questionTexts = (d.questions || []).map(function (q) { return q.question || q.title || ''; });
                questionChoices = (d.questions || []).map(function (q) { return (q.choices || []).map(function (c) { return c.answer || ''; }); });
                info.numQuestions = questions.length;
                lastValidQuizID = uuid;
                input.value = uuid;
                input.style.backgroundColor = 'green';
                status.textContent = 'Loaded: ' + (d.title || uuid);
                isAutoSearching = false;
                onQuestionStart();
            });
        }).catch(function (e) { console.error(e); isAutoSearching = false; detectionFailed = true; status.textContent = 'Auto-detect failed - enter quiz ID manually'; });
    }

    function getAnswerButtons() {
        const sels = [
            '[data-functional-selector^="answer-"]',
            'button[data-functional-selector^="answer-"]',
            '[class*="answer"] button',
            '[class*="choice"] button',
            '[class*="Answer"] button'
        ];
        for (let i = 0; i < sels.length; i++) {
            try {
                const els = Array.from(document.querySelectorAll(sels[i])).filter(function (b) { return b.offsetParent !== null && b.offsetWidth > 20; });
                if (els.length >= 2) return els;
            } catch (e) {}
        }
        return [];
    }

    function highlightAnswers(question) {
        const btns = mapCorrectButtons(question);
        btns.forEach(function (btn) {
            btn.style.outline = '4px solid #22c55e';
            btn.style.outlineOffset = '-4px';
            btn.style.boxShadow = '0 0 20px rgba(34,197,94,0.6)';
            btn.style.backgroundColor = 'rgba(34,197,94,0.2)';
        });
        console.log('[KaHoax] highlighted ' + btns.length + ' buttons');
    }
    function mapCorrectButtons(question) {
        const btns = getAnswerButtons();
        const choices = (questionChoices[info.questionNum] || []);
        const correctTexts = (question.answers || []).map(function (i) { return choices[i] || ''; });
        const result = [];
        const used = new Set();
        correctTexts.forEach(function (ct) {
            let best = -1, bestScore = 0;
            btns.forEach(function (b, di) {
                if (used.has(di)) return;
                const bt = (b.getAttribute('aria-label') || b.textContent || '').trim();
                const sc = similarity(ct, bt);
                if (sc > bestScore) { bestScore = sc; best = di; }
            });
            if (best >= 0 && bestScore >= 0.3) {
                result.push(btns[best]);
                used.add(best);
            } else if (best >= 0) {
                // fallback: push by index if available
                if (btns[best]) { result.push(btns[best]); used.add(best); }
            }
        });
        console.log('[KaHoax] mapCorrectButtons -> ' + result.length + ' buttons');
        if (result.length === 0) {
            (question.answers || []).forEach(function (i) { if (btns[i]) result.push(btns[i]); });
            console.log('[KaHoax] mapCorrectButtons fallback -> ' + result.length);
        }
        return result;
    }

    function answer(question, time) {
        Answered_PPT = PPT;
        const delay = (question.type === 'multiple_select_quiz') ? 60 : 0;
        setTimeout(function () {
            const indices = question.answers || [];
            console.log('[KaHoax] answer() firing keys for', indices);
            indices.forEach(function (a, idx) {
                setTimeout(function () {
                    const key = (+a + 1).toString();
                    window.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
                    const btn = FindByAttributeValue('data-functional-selector', 'answer-' + a, '*');
                    if (btn) btn.click();
                }, idx * 50);
            });
            if (question.type === 'multiple_select_quiz') {
                setTimeout(function () {
                    const submit = FindByAttributeValue('data-functional-selector', 'multi-select-submit-button', '*');
                    if (submit) submit.click();
                }, (indices.length * 50) + 100);
            }
        }, Math.max(0, time - delay));
    }

    function normalizeText(t) {
        return (t || '').toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\\w\\s]/g, ' ').replace(/\\s+/g, ' ').trim();
    }
    function similarity(a, b) {
        const na = normalizeText(a), nb = normalizeText(b);
        if (!na || !nb) return 0;
        if (na === nb) return 1;
        if (na.includes(nb) || nb.includes(na)) return 0.9;
        const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
        const inter = [...ta].filter(x => tb.has(x)).length;
        const union = new Set([...ta, ...tb]).size;
        return union ? inter / union : 0;
    }
    function matchQuestionIndex() {
        const live = getQuestionText();
        if (!live || !questionTexts.length) return info.questionNum >= 0 ? info.questionNum : 0;
        let best = 0, bestScore = 0;
        for (let i = 0; i < questionTexts.length; i++) {
            const sc = similarity(live, questionTexts[i]);
            if (sc > bestScore) { bestScore = sc; best = i; }
        }
        console.log('[KaHoax] matchQuestionIndex -> ' + best + ' score=' + bestScore.toFixed(2));
        return best;
    }

    function onQuestionStart() {
        info.questionNum = matchQuestionIndex();
        console.log('[KaHoax] onQuestionStart q=' + info.questionNum);
        const question = questions[info.questionNum];
        if (!question) return;
        if (showAnswers) highlightAnswers(question);
        if (autoAnswer) answer(question, Math.max(0, (question.time - question.time / (500 / (PPT - 500))) - inputLag));
    }

    setInterval(function () {
        if (stopped) return;
        try {
            const textElement = FindByAttributeValue('data-functional-selector', 'question-index-counter', 'div');
            let qn = null;
            if (textElement) qn = +textElement.textContent - 1;
            else qn = getQuestionNumberFromDOM();
            if (qn !== null && !isNaN(qn)) info.questionNum = qn;
            const hasBtns = !!FindByAttributeValue('data-functional-selector', 'answer-0', '*');
            if (hasBtns && !answeredThisRound) {
                console.log('[KaHoax] answer buttons detected, triggering');
                answeredThisRound = true;
                const qn2 = getQuestionNumberFromDOM();
                if (qn2 !== null && !isNaN(qn2)) info.questionNum = qn2;
                else if (info.questionNum < 0) info.questionNum = 0;
                info.lastAnsweredQuestion = info.questionNum;
                if (questions.length === 0 && !isAutoSearching && !detectionFailed) {
                    console.log('[KaHoax] quiz not loaded - enter ID or click Scan');
                } else if (questions.length > 0) onQuestionStart();
            } else if (!hasBtns) {
                answeredThisRound = false;
            }
            if (autoAnswer && info.ILSetQuestion != info.questionNum) {
                const ppt = Answered_PPT;
                const incEl = FindByAttributeValue('data-functional-selector', 'score-increment', 'span');
                if (incEl) {
                    info.ILSetQuestion = info.questionNum;
                    const increment = +incEl.textContent.split(' ')[1];
                    if (increment != 0) {
                        inputLag += (ppt - increment) * 15;
                        if (inputLag < 0) { inputLag -= (ppt - increment) * 15; inputLag += (ppt - increment / 2) * 15; }
                        inputLag = Math.round(inputLag);
                    }
                }
            }
            qLabel.textContent = 'Question ' + (info.questionNum + 1) + ' / ' + (info.numQuestions > 0 ? info.numQuestions : '?');
            // Ensure UI present
            if (document.body && !document.getElementById('kahox-ui')) {
                console.log('[KaHoax] UI missing in main loop, re-appending');
                document.documentElement.appendChild(ui);
            }
        } catch (e) {
            console.error('[KaHoax] interval error:', e);
        }
    }, 1);
})();
