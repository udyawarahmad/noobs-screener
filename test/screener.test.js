'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..');
const htmlRaw = fs.readFileSync(path.join(REPO, 'renderer/index.html'), 'utf8');
const universeJs = fs.readFileSync(path.join(REPO, 'renderer/universe.js'), 'utf8');
const liveJs = fs.readFileSync(path.join(REPO, 'renderer/live.js'), 'utf8');
const appJs = fs.readFileSync(path.join(REPO, 'renderer/app.js'), 'utf8');
const cssRaw = fs.readFileSync(path.join(REPO, 'renderer/theme.css'), 'utf8');
const mainJs = fs.readFileSync(path.join(REPO, 'main.js'), 'utf8');

function createMockCanvasCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left',
    setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    closePath() {}, fill() {}, arc() {},
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    fillText(text, x, y) { calls.push(['fillText', text, x, y]); },
    createLinearGradient() { return { addColorStop() {} }; }
  };
}

function bootApp({ localStorageSeed = {}, fetchMock, electronFetchMock } = {}) {
  const dom = new JSDOM(htmlRaw, {
    url: 'https://example.test/',
    pretendToBeVisual: true,
    runScripts: 'dangerously'
  });
  const win = dom.window;
  for (const [k, v] of Object.entries(localStorageSeed)) {
    win.localStorage.setItem(k, v);
  }
  win.HTMLCanvasElement.prototype.getContext = function () {
    if (!this._mockCtx) this._mockCtx = createMockCanvasCtx();
    return this._mockCtx;
  };
  Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return 800; }
  });
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.URL.createObjectURL = () => 'blob:mock';
  win.URL.revokeObjectURL = () => {};
  win.fetch = fetchMock || (async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) }));
  if (electronFetchMock) win.electronFetch = electronFetchMock;

  for (const code of [universeJs, liveJs, appJs]) {
    const sc = win.document.createElement('script');
    sc.textContent = code;
    win.document.body.appendChild(sc);
  }
  return { dom, win, doc: win.document };
}

function makeYahooChart({
  symbol = 'RELIANCE.NS', currency = 'INR',
  regularMarketPrice = 1300, regularMarketChangePercent = 1.5,
  regularMarketPreviousClose = null,
  regularMarketDayHigh = 1310, regularMarketDayLow = 1285,
  fiftyTwoWeekHigh = 1600, fiftyTwoWeekLow = 1100,
  regularMarketVolume = 5000000, bars = []
} = {}) {
  return {
    chart: {
      result: [{
        meta: {
          symbol, currency, regularMarketPrice, regularMarketChangePercent,
          regularMarketPreviousClose,
          regularMarketDayHigh, regularMarketDayLow,
          fiftyTwoWeekHigh, fiftyTwoWeekLow, regularMarketVolume, longName: symbol
        },
        timestamp: bars.map(b => b.t),
        indicators: {
          quote: [{
            open: bars.map(b => b.o), high: bars.map(b => b.h),
            low: bars.map(b => b.l), close: bars.map(b => b.c),
            volume: bars.map(b => b.v)
          }],
          adjclose: [{ adjclose: bars.map(b => b.adj !== undefined ? b.adj : b.c) }]
        }
      }]
    }
  };
}

function makeScreenerHTML({
  name = 'Test Company Ltd', price = '1,300', chg = '+1.50%', sector = 'IT - Software',
  ratios = {
    'Market Cap': '₹ 1,00,000 Cr.', 'Stock P/E': '25.0', 'Book Value': '₹ 200',
    'Dividend Yield': '1.20 %', 'ROCE': '22.5 %', 'ROE': '18.0 %', 'Face Value': '₹ 10.0'
  },
  quartersCols = ['Sep 2023', 'Dec 2023', 'Mar 2024', 'Jun 2024', 'Sep 2024', 'Dec 2024', 'Mar 2025', 'Jun 2025', 'Sep 2025'],
  quartersRows = [
    ['Sales +', '1000', '1000', '1100', '1200', '1200', '1150', '1250', '1300', '1500'],
    ['Operating Profit', '200', '200', '220', '240', '240', '230', '250', '260', '300'],
    ['Net Profit +', '100', '100', '110', '120', '120', '115', '125', '130', '150']
  ],
  pnlCols = ['Mar 2021', 'Mar 2022', 'Mar 2023', 'Mar 2024', 'Mar 2025', 'TTM'],
  pnlRows = [
    ['Sales +', '3000', '3500', '4000', '4500', '5000', '5000'],
    ['Operating Profit', '600', '700', '800', '900', '1000', '1000'],
    ['OPM %', '20%', '20%', '20%', '20%', '20%', '20%'],
    ['Net Profit +', '300', '350', '400', '450', '500', '500'],
    ['EPS in Rs', '10', '12', '14', '16', '18', '18']
  ],
  bsCols = ['Mar 2022', 'Mar 2023', 'Mar 2024', 'Mar 2025'],
  bsRows = [
    ['Share Capital +', '100', '100', '100', '100'],
    ['Reserves', '900', '1100', '1300', '1500'],
    ['Borrowings +', '400', '400', '400', '400']
  ],
  shpCols = ['Dec 2024', 'Mar 2025', 'Jun 2025', 'Sep 2025'],
  shpRows = [
    ['Promoters +', '50.00%', '50.00%', '50.00%', '50.00%'],
    ['FIIs +', '20.00%', '20.00%', '20.00%', '20.00%'],
    ['DIIs +', '15.00%', '15.00%', '15.00%', '15.00%'],
    ['Public +', '15.00%', '15.00%', '15.00%', '15.00%']
  ],
  peerHeads = ['S.No.', 'Name', 'CMP Rs.', 'P/E', 'Mar Cap Rs.Cr.', 'Div Yld %', 'NP Qtr Rs.Cr.', 'Qtr Profit Var %', 'Sales Qtr Rs.Cr.', 'Qtr Sales Var %', 'ROCE %'],
  peerRows = [
    ['1.', '<a href="/company/TESTCO/consolidated/">Test Company</a>', '1300', '25.0', '100000', '1.2', '140', '33.3', '1400', '33.3', '22.5'],
    ['2.', '<a href="/company/PEER2/consolidated/">Peer Two</a>', '500', '15.0', '50000', '2.0', '80', '10.0', '900', '12.0', '18.0']
  ]
} = {}) {
  const ratioLis = Object.entries(ratios).map(([k, v]) => `<li><span class="name">${k}</span><span class="value">${v}</span></li>`).join('');
  const tbl = (cols, rows) => `<table class="data-table"><thead><tr><th></th>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<!DOCTYPE html><html><body>
    <div id="top"><h1>${name}</h1><div class="line-height-14">₹ ${price} ${chg}</div></div>
    <ul id="top-ratios">${ratioLis}</ul>
    <section id="peers">
      <a title="Broad Industry">${sector}</a>
      <table class="data-table"><tbody>
        <tr>${peerHeads.map(h => `<th>${h}</th>`).join('')}</tr>
        ${peerRows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}
      </tbody></table>
    </section>
    <section id="analysis"><div class="pros"><ul><li>Good ROE</li></ul></div><div class="cons"><ul><li>High P/E</li></ul></div></section>
    <section id="quarters">${tbl(quartersCols, quartersRows)}</section>
    <section id="profit-loss">${tbl(pnlCols, pnlRows)}</section>
    <section id="balance-sheet">${tbl(bsCols, bsRows)}</section>
    <section id="cash-flow">${tbl(['Mar 2024', 'Mar 2025'], [['Cash from Operating Activity +', '500', '600']])}</section>
    <section id="ratios">${tbl(['Mar 2024', 'Mar 2025'], [['ROE %', '17%', '18%']])}</section>
    <section id="quarterly-shp">${tbl(shpCols, shpRows)}</section>
    <div class="company-profile"><p>A company profile paragraph that is definitely longer than forty characters long.</p></div>
  </body></html>`;
}

(async () => {
  let pass = 0, fail = 0;
  async function check(name, fn) {
    try { await fn(); pass++; console.log('PASS:', name); }
    catch (e) { fail++; console.error('FAIL:', name, '->', e.message); }
  }

  await check('liveCacheClear preserves watchlist and theme while clearing cache', () => {
    const { win } = bootApp({
      localStorageSeed: {
        screenone_wl: '["RELIANCE","TCS"]',
        screenone_theme: 'dark',
        'screenone3:co:RELIANCE': '{"t":9999999999999,"v":{}}',
        'screenone3:ch3:RELIANCE.NS': '{"t":9999999999999,"v":{}}'
      }
    });
    win.liveCacheClear();
    assert.strictEqual(win.localStorage.getItem('screenone_wl'), '["RELIANCE","TCS"]');
    assert.strictEqual(win.localStorage.getItem('screenone_theme'), 'dark');
    assert.strictEqual(win.localStorage.getItem('screenone3:co:RELIANCE'), null);
    assert.strictEqual(win.localStorage.getItem('screenone3:ch3:RELIANCE.NS'), null);
  });

  await check('cagr3 excludes TTM and returns null on sign flip or deepening losses', () => {
    const { win } = bootApp();
    const coA = win.parseCompany(makeScreenerHTML(), 'TEST');
    assert(Math.abs(coA.fund.gs - 12.6248) < 0.05, `gs=${coA.fund.gs}`);

    const coB = win.parseCompany(makeScreenerHTML({
      pnlRows: [
        ['Sales +', '100', '150', '200', '250', '300', '350'],
        ['Net Profit +', '-200', '-150', '-100', '-50', '100', '200']
      ]
    }), 'TURN');
    assert.strictEqual(coB.fund.gp, null);

    const coC = win.parseCompany(makeScreenerHTML({
      pnlRows: [
        ['Sales +', '100', '150', '200', '250', '300', '350'],
        ['Net Profit +', '-50', '-80', '-100', '-200', '-400', '-800']
      ]
    }), 'LOSS');
    assert.strictEqual(coC.fund.gp, null);
  });

  await check('Negative net worth sets de=null, negEq=true, styled red, and fails D/E < 0.2', () => {
    const { win } = bootApp();
    const co = win.parseCompany(makeScreenerHTML({
      bsRows: [
        ['Share Capital +', '1000', '1000', '1000', '1000'],
        ['Reserves', '-2000', '-2500', '-3000', '-4000'],
        ['Borrowings +', '5000', '5500', '6000', '6000']
      ]
    }), 'IDEA');
    assert.strictEqual(co.fund.de, null);
    assert.strictEqual(co.fund.negEq, true);
    const cardsHtml = win.metricCards(co, null);
    assert(cardsHtml.includes('class="neg">Neg. Eq.</b>'), cardsHtml);
    win.renderScreener();
    const f = Object.assign({}, win.S.scr, { deMax: 0.2 });
    assert.strictEqual(win.rowPasses(win.UNI['IDEA'], f, co.fund, null), false);
  });

  await check('Equity Capital label on balance sheet is parsed for D/E', () => {
    const { win } = bootApp();
    const co = win.parseCompany(makeScreenerHTML({
      bsRows: [
        ['Equity Capital +', '100', '100', '100', '100'],
        ['Reserves', '900', '1100', '1300', '1500'],
        ['Borrowings +', '400', '400', '400', '400']
      ]
    }), 'TEST');
    assert.strictEqual(co.fund.de, 0.25);
  });

  await check('Quarterly table computes true YoY (col i vs col i-4), not QoQ', () => {
    const { win, doc } = bootApp();
    const co = win.parseCompany(makeScreenerHTML(), 'RELIANCE');
    win.renderStatements(co);
    const qHtml = doc.getElementById('qTable').innerHTML;
    assert(qHtml.includes('+25.0% YoY'));
    assert(!qHtml.includes('+15.4% YoY'));
  });

  await check('Annual P&L skips YoY on TTM and skips negative prior base', () => {
    const { win, doc } = bootApp();
    const co = win.parseCompany(makeScreenerHTML({
      pnlCols: ['Mar 2023', 'Mar 2024', 'Mar 2025', 'TTM'],
      pnlRows: [
        ['Sales +', '1000', '1200', '1500', '1600'],
        ['Net Profit +', '-100', '100', '150', '160']
      ]
    }), 'RELIANCE');
    win.renderStatements(co);
    const pHtml = doc.getElementById('pnlTable').innerHTML;
    assert(!pHtml.includes('-200.0% YoY'));
    assert(pHtml.includes('+50.0% YoY'));
    assert(!pHtml.includes('+6.7% YoY'));
  });

  await check('Peer Comparison includes CMP and P/E columns', () => {
    const { win, doc } = bootApp();
    const co = win.parseCompany(makeScreenerHTML(), 'RELIANCE');
    win.renderPeers(co);
    const peerHtml = doc.getElementById('peersTable').innerHTML;
    assert(peerHtml.includes('CMP ₹'));
    assert(peerHtml.includes('P/E'));
    assert(peerHtml.includes('ROCE%'));
  });

  await check('Shareholding includes Government row for PSUs', () => {
    const { win, doc } = bootApp();
    const co = win.parseCompany(makeScreenerHTML({
      shpRows: [
        ['Promoters +', '0.00%', '0.00%', '0.00%', '0.00%'],
        ['Government +', '57.00%', '57.00%', '57.00%', '57.00%'],
        ['FIIs +', '10.00%', '10.00%', '10.00%', '10.00%'],
        ['DIIs +', '20.00%', '20.00%', '20.00%', '20.00%'],
        ['Public +', '13.00%', '13.00%', '13.00%', '13.00%']
      ]
    }), 'SBIN');
    win.renderSH(co);
    assert(doc.getElementById('shTable').innerHTML.includes('Government'));
  });

  await check('drawFinChart keeps exact year labels aligned when TTM or middle column is null', () => {
    const { win, doc } = bootApp();
    const co = win.parseCompany(makeScreenerHTML({
      pnlCols: ['Mar 2022', 'Mar 2023', 'Mar 2024', 'Mar 2025', 'TTM'],
      pnlRows: [['Sales +', '100', '200', '300', '400', '–']]
    }), 'RELIANCE');
    win.S.finMode = 'sales';
    win.drawFinChart(co);
    const texts = doc.getElementById('finChart')._mockCtx.calls.filter(c => c[0] === 'fillText').map(c => c[1]);
    assert(texts.includes("'2022") && !texts.includes('TTM'));
  });

  await check('Screener sorting by sym and wl works, and OPM column is displayed', () => {
    const { win, doc } = bootApp();
    win.CO['TCS'] = { fund: { mcap: 500000, opm: 25 } };
    win.CO['RELIANCE'] = { fund: { mcap: 1000000, opm: 15 } };
    assert.strictEqual(win.sortVal({ sym: 'RELIANCE' }, win.CO['RELIANCE'].fund, null, 'sym'), 'RELIANCE');
    assert.strictEqual(win.sortVal({ sym: 'TCS' }, win.CO['TCS'].fund, null, 'sym'), 'TCS');
    win.S.wl = ['TCS'];
    assert.strictEqual(win.sortVal({ sym: 'TCS' }, null, null, 'wl'), 1);
    assert.strictEqual(win.sortVal({ sym: 'RELIANCE' }, null, null, 'wl'), 0);
    win.renderScreener();
    assert(doc.getElementById('screenTable').innerHTML.includes('OPM%'));
  });

  await check('Screener filter 0 and >= 1000 values work accurately and NaN fails active filters', () => {
    const { win, doc } = bootApp();
    win.renderScreener();
    doc.getElementById('f_opm').value = '0';
    doc.getElementById('f_pe').value = '1500';
    win.readScreenerInputs();
    assert.strictEqual(win.S.scr.opmMin, 0);
    assert.strictEqual(win.S.scr.peMax, 1500);
    const passCo = { fund: { mcap: 1000, pe: 1200, opm: 5, gp: NaN } };
    const failOpm = { fund: { mcap: 1000, pe: 1200, opm: -2 } };
    const failPe = { fund: { mcap: 1000, pe: 1600, opm: 5 } };
    assert.strictEqual(win.rowPasses({ sym: 'A', sec: 'IT' }, win.S.scr, passCo.fund, null), true);
    assert.strictEqual(win.rowPasses({ sym: 'B', sec: 'IT' }, win.S.scr, failOpm.fund, null), false);
    assert.strictEqual(win.rowPasses({ sym: 'C', sec: 'IT' }, win.S.scr, failPe.fund, null), false);
    doc.getElementById('f_gp').value = '15';
    win.readScreenerInputs();
    assert.strictEqual(win.rowPasses({ sym: 'A', sec: 'IT' }, win.S.scr, passCo.fund, null), false);
  });

  await check('exportStock handles Banks, missing cells, and Index mode', () => {
    const { win } = bootApp();
    const csvs = [];
    win.Blob = function (parts) { csvs.push(parts[0]); };
    const bankCo = win.parseCompany(makeScreenerHTML({
      pnlCols: ['Mar 2024', 'Mar 2025'],
      pnlRows: [
        ['Revenue +', '100,000', '120,000'],
        ['Financing Profit', '30,000', '35,000'],
        ['Net Profit +', '15,000', '18,000'],
        ['EPS in Rs', '50', '60']
      ]
    }), 'HDFCBANK');
    bankCo.pnl.cols.push('TTM');
    win.CO['HDFCBANK'] = bankCo;
    win.S.mode = 'stock';
    win.S.sym = 'HDFCBANK';
    win.exportStock();
    assert(csvs[0].includes('"Mar 2024","100000","30000","15000","50"'));

    win.S.mode = 'index';
    win.S.index = { y: '^NSEI', label: 'NIFTY 50' };
    win.LAST_CH = { pts: [{ t: 1700000000000, o: 24000, h: 24100, l: 23900, c: 24050, v: 0 }] };
    win.exportStock();
    assert(csvs[1].includes('Date,Open,High,Low,Close,Volume') && csvs[1].includes('24050.00'));
  });

  await check('Short IPO history sets ret1y=null & keeps intraday bar when adj=null', async () => {
    const { win } = bootApp();
    const barsShort = [];
    for (let i = 0; i < 30; i++) barsShort.push({ t: 1730000000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 });
    win.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(makeYahooChart({ symbol: 'SWIGGY.NS', bars: barsShort })) });
    const chShort = await win.loadChart('SWIGGY.NS');
    assert.strictEqual(chShort.ret1y, null);

    const barsIntra = [
      { t: 1700000000, o: 100, h: 105, l: 99, c: 102, adj: 102, v: 1000 },
      { t: 1700086400, o: 103, h: 106, l: 101, c: 105, adj: 105, v: 2000 },
      { t: 1700172800, o: 106, h: 112, l: 105, c: 110, adj: null, v: 3000 }
    ];
    win.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(makeYahooChart({ symbol: 'TCS.NS', regularMarketPrice: 110, bars: barsIntra })) });
    const chIntra = await win.loadChart('TCS.NS');
    assert.strictEqual(chIntra.prevClose, 105);
    assert.strictEqual(chIntra.pts[chIntra.pts.length - 1].o, 106);
  });

  await check('Index strip matches hero and hides missing 52W bar', async () => {
    const { win, doc } = bootApp();
    const bars = [
      { t: 1700000000, o: 24000, h: 24100, l: 23900, c: 24000, v: 0 },
      { t: 1700086400, o: 24050, h: 24200, l: 24000, c: 24100, v: 0 }
    ];
    const yJson = makeYahooChart({ symbol: '^NSEI', regularMarketPrice: 24500, regularMarketChangePercent: 1.66, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, bars });
    win.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(yJson) });
    win.renderIndices();
    await new Promise(r => setTimeout(r, 30));
    const stripText = doc.querySelector('.idx[data-y="^NSEI"]').textContent;
    assert(stripText.includes('24,500.0') && stripText.includes('+1.7%'));
    const ch = await win.loadChart('^NSEI');
    win.renderIndex(ch, 'NIFTY 50', '^NSEI');
    assert.strictEqual(doc.getElementById('w52wrap').innerHTML, '');
  });

  await check('httpText respects preferProxy and stops on Electron HTTP 404', async () => {
    const called = [];
    const { win } = bootApp({
      fetchMock: async (u) => { called.push(String(u)); return { ok: true, status: 200, text: async () => 'ok' }; }
    });
    await win.httpText('https://www.screener.in/company/RELIANCE/', true);
    assert(called[0].startsWith('https://corsproxy.io/'));

    const { win: win2 } = bootApp({
      electronFetchMock: async () => ({ ok: false, status: 404, body: 'not found' }),
      fetchMock: async () => { throw new Error('should not fall back on 404'); }
    });
    await assert.rejects(() => win2.httpText('https://www.screener.in/company/BAD/', true), /HTTP 404/);
  });

  await check('Search prompt, dynamic sector dropdown, and index race condition', async () => {
    const { win, doc } = bootApp();
    doc.getElementById('searchInput').value = 'Q';
    win.renderSearchDrop('Q');
    assert(doc.getElementById('searchDrop').textContent.includes('Type at least 2 characters'));

    win.renderScreener();
    let resolveScreener;
    const sp = new Promise(r => { resolveScreener = r; });
    win.fetch = async (u) => {
      if (String(u).includes('screener.in')) return { ok: true, status: 200, text: async () => await sp };
      return { ok: false, status: 404 };
    };
    win.S.sym = 'TCS'; win.S.mode = 'stock';
    const p = win.loadAndRender('TCS');
    win.S.mode = 'index'; win.S.index = { y: '^NSEI', label: 'NIFTY 50' };
    doc.getElementById('stName').textContent = 'NIFTY 50';
    resolveScreener(makeScreenerHTML({ name: 'Tata Consultancy Services', sector: 'Quantum Tech' }));
    await p;
    assert.strictEqual(doc.getElementById('stName').textContent, 'NIFTY 50');

    win.S.mode = 'stock'; win.S.sym = 'RELIANCE';
    win.fetch = async (u) => String(u).includes('screener.in')
      ? { ok: true, status: 200, text: async () => makeScreenerHTML({ sector: 'Quantum Tech' }) }
      : { ok: false, status: 404 };
    await win.loadAndRender('RELIANCE');
    const opts = Array.from(doc.getElementById('f_sector').options).map(o => o.value);
    assert(opts.includes('Quantum Tech'));
  });

  await check('Negative Book Value hides P/B, BSE links fixed, CSS sticky & main.js external links fixed', () => {
    const { win, doc } = bootApp();
    const co = win.parseCompany(makeScreenerHTML({
      ratios: { 'Market Cap': '₹ 50,000 Cr.', 'Stock P/E': '', 'Book Value': '₹ -200', 'ROE': '-50%', 'ROCE': '-10%', 'Dividend Yield': '0%', 'Face Value': '₹ 10' }
    }), '500325');
    co.nse = null;
    assert(!win.metricCards(co, { price: 1300 }).includes('-6.5x'));
    win.renderDocs(co);
    win.renderAbout(co);
    assert(!doc.getElementById('docsLinks').innerHTML.includes('nseindia.com'));
    assert(doc.getElementById('docsLinks').innerHTML.includes('500325.BO'));
    assert(doc.getElementById('aboutFacts').innerHTML.includes('500325.BO'));
    assert(doc.getElementById('aboutFacts').innerHTML.includes('BSE code'));
    assert(cssRaw.includes('scroll-padding-top:52px'));
    assert(cssRaw.includes('table.fin th.sticky2,table.fin td.sticky2{text-align:left}'));
    assert(mainJs.includes('setWindowOpenHandler'));
    assert(universeJs.includes("sym: 'LTIM'") && universeJs.includes("LTIM: ['MINDTREE']"));
  });

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})();
