(function () {
    'use strict';
    console.log('[KaHoax] SCRIPT LOADED');
    const Version = '2.0';
    const PROXY = 'https://damp-leaf-16aa.johnwee.workers.dev';

    let questions = [];
    const info = { numQuestions: 0, questionNum: -1, lastAnsweredQuestion: -1, ILSetQuestion: -1 };
    let PPT = 900, Answered_PPT = 900, autoAnswer = true, showAnswers = true, inputLag = 100;
    let lastValidQuizID = null, isAutoSearching = false;
    let networkQuizId = null;
    let answeredThisRound = false;

    function log(msg) { try { console.log('[KaHoax]', msg); } catch (e) {} }

    function FindByAttributeValue(attribute, value, element_type) {
        element_type = element_type || '*';
        const All = document.getElementsByTagName(element_type);
        for (let i = 0; i < All.length; i++) if (All[i].getAttribute(attribute) == value) return All[i];
    }

    function detectQuizIdFromGlobals() {
        log('detectQuizIdFromGlobals()');
        if (networkQuizId && isValidGameId(networkQuizId)) { log('found via network: ' + networkQuizId); return networkQuizId; }
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
    closeBtn.addEventListener('click', function () { document.body.removeChild(ui); autoAnswer = false; showAnswers = false; });

    // drag
    let dragging = false, ox, oy;
    handle.addEventListener('mousedown', function (e) { dragging = true; ox = e.clientX - ui.getBoundingClientRect().left; oy = e.clientY - ui.getBoundingClientRect().top; });
    document.addEventListener('mousemove', function (e) { if (dragging) { ui.style.left = (e.clientX - ox) + 'px'; ui.style.top = (e.clientY - oy) + 'px'; } });
    document.addEventListener('mouseup', function () { dragging = false; });

    document.body.appendChild(ui);
    console.log('[KaHoax] UI appended to body');

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
        log('autoLoadByQuestion()');
        const detected = detectQuizIdFromGlobals();
        if (detected) {
            isAutoSearching = true;
            const detailUrl = PROXY + '/api-proxy/' + encodeURIComponent(detected);
            fetch(detailUrl).then(function (r) { return r.json(); }).then(function (d) {
                questions = parseQuestions(d.questions);
                info.numQuestions = questions.length;
                lastValidQuizID = detected;
                input.value = detected;
                input.style.backgroundColor = 'green';
                status.textContent = 'Loaded: ' + (d.title || detected);
                isAutoSearching = false;
                onQuestionStart();
            }).catch(function () { isAutoSearching = false; fallbackTextSearch(); });
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
            if (!results.length) { isAutoSearching = false; status.textContent = 'No match'; return; }
            const uuid = results[0].card.uuid;
            const detailUrl = PROXY + '/api-proxy/' + encodeURIComponent(uuid);
            return fetch(detailUrl).then(function (r) { return r.json(); }).then(function (d) {
                questions = parseQuestions(d.questions);
                info.numQuestions = questions.length;
                lastValidQuizID = uuid;
                input.value = uuid;
                input.style.backgroundColor = 'green';
                status.textContent = 'Loaded: ' + (d.title || uuid);
                isAutoSearching = false;
                onQuestionStart();
            });
        }).catch(function (e) { console.error(e); isAutoSearching = false; status.textContent = 'Auto-detect error'; });
    }

    function highlightAnswers(question) {
        (question.answers || []).forEach(function (answer) {
            setTimeout(function () {
                const btn = FindByAttributeValue('data-functional-selector', 'answer-' + answer, '*');
                if (btn) btn.style.backgroundColor = 'rgb(0,255,0)';
            }, 0);
        });
        (question.incorrectAnswers || []).forEach(function (answer) {
            setTimeout(function () {
                const btn = FindByAttributeValue('data-functional-selector', 'answer-' + answer, '*');
                if (btn) btn.style.backgroundColor = 'rgb(255,0,0)';
            }, 0);
        });
    }

    function answer(question, time) {
        Answered_PPT = PPT;
        const delay = (question.type === 'multiple_select_quiz') ? 60 : 0;
        setTimeout(function () {
            if (question.type === 'quiz') {
                const key = (+question.answers[0] + 1).toString();
                window.dispatchEvent(new KeyboardEvent('keydown', { key: key }));
            }
            if (question.type === 'multiple_select_quiz') {
                (question.answers || []).forEach(function (a) {
                    setTimeout(function () {
                        const key = (+a + 1).toString();
                        window.dispatchEvent(new KeyboardEvent('keydown', { key: key }));
                    }, 0);
                });
                setTimeout(function () {
                    const btn = FindByAttributeValue('data-functional-selector', 'multi-select-submit-button', '*');
                    if (btn) btn.click();
                }, 0);
            }
        }, time - delay);
    }

    function onQuestionStart() {
        log('onQuestionStart q=' + info.questionNum);
        const question = questions[info.questionNum];
        if (!question) return;
        if (showAnswers) highlightAnswers(question);
        if (autoAnswer) answer(question, (question.time - question.time / (500 / (PPT - 500))) - inputLag);
    }

    setInterval(function () {
        const textElement = FindByAttributeValue('data-functional-selector', 'question-index-counter', 'div');
        if (textElement) info.questionNum = +textElement.textContent - 1;
        const hasBtns = !!FindByAttributeValue('data-functional-selector', 'answer-0', '*');
        if (hasBtns && !answeredThisRound) {
            console.log('[KaHoax] answer buttons detected, triggering');
            answeredThisRound = true;
            if (textElement) info.questionNum = +textElement.textContent - 1;
            else info.questionNum = info.questionNum + 1;
            info.lastAnsweredQuestion = info.questionNum;
            if (questions.length === 0 && !isAutoSearching) autoLoadByQuestion();
            else onQuestionStart();
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
    }, 1);
})();
