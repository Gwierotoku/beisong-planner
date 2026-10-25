/* 背诵规划表 —— 艾宾浩斯复习计划
 * 纯前端、localStorage 存储，无第三方依赖。
 */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  const STORE_KEY = 'beisong-plan-v1';
  const MAX_SPAN_DAYS = 4 * 365; // 4 年上限（从首次背诵当天算起）
  const SESSION_BASE = 1.7; // 复习时间按 1.7 的幂增长
  const PAGE_UNITS = 34; // 每页可容纳的“行单位”，组头/边框各占一些
  const GROUP_OVERHEAD = 2; // 一个科目组的组头、边框和间距所占的行单位
  const MIN_SPLIT = 2; // 拆分科目组时，当前页至少还能放这么多条才拆
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 预设标签色（低饱和平面色），科目也可以使用任意自定义颜色
  const PRESET_COLORS = [
    '#f2e5c9',
    '#d9e7f2',
    '#ddeada',
    '#f3dde0',
    '#e5deef',
    '#f6e0cd',
    '#dce5e8',
    '#d8ecea',
    '#ede8d5',
    '#e9e4e0',
  ];
  const DEFAULT_COLOR = '#d9e7f2';

  /* ---------------- 日期工具 ---------------- */
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(ymd, days) {
    const [y, m, d] = ymd.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d) + days * 86400000;
    const dt = new Date(t);
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }

  function diffDays(from, to) {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
  }

  function isValidYmd(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
    return d <= new Date(y, m, 0).getDate();
  }

  function fmtShort(ymd) {
    return ymd ? ymd.replace(/-/g, '/') : '';
  }

  function fmtLong(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return y + '年' + m + '月' + d + '日 ' + WEEKDAYS[wd];
  }

  function fmtMinutes(minutes) {
    const v = Math.round(minutes * 10) / 10;
    return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + ' 分钟';
  }

  /* ---------------- 颜色工具 ---------------- */
  function normalizeHex(value) {
    if (typeof value !== 'string') return null;
    let v = value.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(v)) {
      v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    return /^#[0-9a-f]{6}$/.test(v) ? v : null;
  }

  function hexToRgb(hex) {
    const v = normalizeHex(hex);
    if (!v) return null;
    return {
      r: parseInt(v.slice(1, 3), 16),
      g: parseInt(v.slice(3, 5), 16),
      b: parseInt(v.slice(5, 7), 16),
    };
  }

  // 根据底色亮度自动选深色或白色文字
  function readableText(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return '#262626';
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.62 ? '#262626' : '#ffffff';
  }

  /* ---------------- 通用工具 ---------------- */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid(prefix) {
    return (
      prefix +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7)
    );
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /* ---------------- 数据与存储 ---------------- */
  function defaultState() {
    return {
      version: 1,
      subjects: [],
      entries: [],
      settings: { cols: 3 },
    };
  }

  function normalizeState(raw) {
    const out = defaultState();
    if (!raw || typeof raw !== 'object') return out;

    const seenSubjects = new Set();
    if (Array.isArray(raw.subjects)) {
      raw.subjects.forEach(function (s) {
        if (!s || typeof s !== 'object') return;
        if (typeof s.id !== 'string' || !s.id || seenSubjects.has(s.id)) return;
        const name = String(s.name == null ? '' : s.name).trim().slice(0, 20);
        if (!name) return;
        seenSubjects.add(s.id);
        let color = DEFAULT_COLOR;
        if (
          typeof s.color === 'number' &&
          Number.isInteger(s.color) &&
          s.color >= 0 &&
          s.color < PRESET_COLORS.length
        ) {
          // 兼容旧版本：颜色原先存的是预设色索引
          color = PRESET_COLORS[s.color];
        } else {
          const hex = normalizeHex(s.color);
          if (hex) color = hex;
        }
        out.subjects.push({
          id: s.id,
          name: name,
          color: color,
          archived: !!s.archived,
          createdAt: typeof s.createdAt === 'string' ? s.createdAt : nowIso(),
        });
      });
    }

    const seenEntries = new Set();
    if (Array.isArray(raw.entries)) {
      raw.entries.forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        if (typeof e.id !== 'string' || !e.id || seenEntries.has(e.id)) return;
        const name = String(e.name == null ? '' : e.name).trim().slice(0, 100);
        if (!name) return;
        if (!isValidYmd(e.firstDate)) return;
        const firstMinutes = Number(e.firstMinutes);
        if (!Number.isFinite(firstMinutes) || firstMinutes <= 0) return;

        const done = {};
        if (e.done && typeof e.done === 'object') {
          Object.keys(e.done).forEach(function (k) {
            const n = Number(k);
            const v = e.done[k];
            if (Number.isInteger(n) && n >= 2 && n <= 50 && isValidYmd(v)) {
              done[n] = v;
            }
          });
        }

        seenEntries.add(e.id);
        out.entries.push({
          id: e.id,
          name: name,
          subjectId: typeof e.subjectId === 'string' ? e.subjectId : null,
          firstDate: e.firstDate,
          firstMinutes: firstMinutes,
          done: done,
          createdAt: typeof e.createdAt === 'string' ? e.createdAt : nowIso(),
          updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : undefined,
        });
      });
    }

    const cols = Number(raw.settings && raw.settings.cols);
    out.settings.cols = [2, 3, 4].indexOf(cols) >= 0 ? cols : 3;
    return out;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (err) {
      console.warn('读取本地数据失败：', err);
      return defaultState();
    }
  }

  let state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('保存本地数据失败：', err);
      toast('数据保存失败，请检查浏览器是否禁用了本地存储。');
    }
  }

  const ui = {
    view: 'today',
    date: todayStr(),
    search: '',
    subjectFilter: 'all',
    sort: 'name',
  };

  /* ---------------- 查询辅助 ---------------- */
  function findEntry(id) {
    return state.entries.find(function (e) {
      return e.id === id;
    });
  }

  function subjectById(id) {
    return state.subjects.find(function (s) {
      return s.id === id;
    });
  }

  function subjectName(id) {
    const s = subjectById(id);
    return s ? s.name : '未分类';
  }

  function activeSubjects() {
    return state.subjects.filter(function (s) {
      return !s.archived;
    });
  }

  function subjectEntryCount(id) {
    return state.entries.filter(function (e) {
      return e.subjectId === id;
    }).length;
  }

  function subjectTag(subjectId) {
    const s = subjectById(subjectId);
    if (!s) {
      return (
        '<span class="subject-tag" style="background:#eeeeea;color:#77776f">未分类</span>'
      );
    }
    const color = normalizeHex(s.color) || DEFAULT_COLOR;
    return (
      '<span class="subject-tag" style="background:' +
      color +
      ';color:' +
      readableText(color) +
      '" title="科目：' +
      esc(s.name) +
      '">' +
      esc(s.name) +
      '</span>'
    );
  }

  /* ---------------- 核心算法：复习计划 ---------------- */
  /**
   * 首次背诵当天记为第 1 天。
   * 第 n 次背诵安排在第 1.7^(n-1) 天（四舍五入），
   * 也就是第 2、3、5、8、14、24…… 天。
   * 第 n 次建议用时 = 首次用时 × n^(-1/2)。
   */
  function buildPlan(entry) {
    const plan = [
      {
        n: 1,
        date: entry.firstDate,
        minutes: entry.firstMinutes,
        isFirst: true,
      },
    ];
    for (let n = 2; ; n++) {
      const dayIndex = Math.pow(SESSION_BASE, n - 1);
      if (dayIndex > MAX_SPAN_DAYS) break;
      plan.push({
        n: n,
        date: addDays(entry.firstDate, Math.round(dayIndex) - 1),
        minutes: entry.firstMinutes / Math.sqrt(n),
      });
    }
    return plan;
  }

  function isSessionDone(entry, n) {
    if (n === 1) return true;
    return !!(entry.done && entry.done[n]);
  }

  function pendingSession(entry, dateStr) {
    const plan = buildPlan(entry);
    for (let i = 0; i < plan.length; i++) {
      const s = plan[i];
      if (s.n === 1) continue;
      if (isSessionDone(entry, s.n)) continue;
      if (s.date > dateStr) return null;
      return {
        n: s.n,
        date: s.date,
        minutes: s.minutes,
        overdue: Math.max(0, diffDays(s.date, dateStr)),
      };
    }
    return null;
  }

  function nextSession(entry) {
    const plan = buildPlan(entry);
    for (let i = 0; i < plan.length; i++) {
      const s = plan[i];
      if (s.n === 1) continue;
      if (!isSessionDone(entry, s.n)) return s;
    }
    return null;
  }

  function completedSessionsOn(entry, dateStr) {
    return buildPlan(entry).filter(function (s) {
      return s.n > 1 && entry.done && entry.done[s.n] === dateStr;
    });
  }

  function progressOf(entry) {
    const plan = buildPlan(entry);
    const doneCount =
      1 + Object.keys(entry.done || {}).filter(function (k) {
        return Number(k) >= 2;
      }).length;
    return { done: doneCount, total: plan.length };
  }

  function todayPendingRows() {
    const today = todayStr();
    const rows = [];
    state.entries.forEach(function (entry) {
      const s = pendingSession(entry, today);
      if (s) rows.push({ entry: entry, session: s });
    });
    rows.sort(function (a, b) {
      return (
        b.session.overdue - a.session.overdue ||
        a.session.date.localeCompare(b.session.date) ||
        a.entry.name.localeCompare(b.entry.name, 'zh-CN')
      );
    });
    return rows;
  }

  /* ---------------- 渲染：今日复习 ---------------- */
  function paperHeadHtml(date, isToday, rows, totalMinutes, overdueCount, pageIndex, pageCount) {
    return (
      '<div class="paper-head">' +
      '<div>' +
      '<div class="paper-title">' +
      esc(fmtLong(date)) +
      ' · ' +
      (isToday ? '今日复习' : '复习清单') +
      '</div>' +
      '<div class="paper-sub">' +
      (rows.length
        ? '待复习 ' +
          rows.length +
          ' 条 · 建议总用时 ' +
          Math.round(totalMinutes) +
          ' 分钟' +
          (overdueCount ? ' · 逾期 ' + overdueCount + ' 条' : '')
        : '本日没有需要复习的条目') +
      '</div>' +
      '</div>' +
      '<div class="paper-page">第 ' +
      pageIndex +
      ' / ' +
      pageCount +
      ' 页</div>' +
      '</div>'
    );
  }

  // 相同科目的条目放在同一组，组按科目创建顺序排列，未分类放最后
  function groupPendingRows(rows) {
    const knownIds = new Set(
      state.subjects.map(function (s) {
        return s.id;
      })
    );
    const bySubject = new Map();
    rows.forEach(function (r) {
      const key = knownIds.has(r.entry.subjectId) ? r.entry.subjectId : '__none__';
      if (!bySubject.has(key)) bySubject.set(key, []);
      bySubject.get(key).push(r);
    });

    const groups = [];
    state.subjects.forEach(function (subject) {
      if (bySubject.has(subject.id)) {
        groups.push({ subject: subject, rows: bySubject.get(subject.id) });
        bySubject.delete(subject.id);
      }
    });
    if (bySubject.has('__none__')) {
      groups.push({ subject: null, rows: bySubject.get('__none__') });
    }
    return groups;
  }

  /**
   * 把科目组装进 A4 页面。一行条目占 1 个行单位，一个科目组的组头/边框/间距
   * 占 GROUP_OVERHEAD 个行单位。当前页剩余空间不足时换页；空间还够时允许
   * 一个科目组分到两页，并在下一页标“（续）”。
   */
  function paginateGroups(groups) {
    const pages = [];
    let current = { groups: [], units: 0 };

    groups.forEach(function (group) {
      let remaining = group.rows.slice();
      let chunkIndex = 0;

      while (remaining.length) {
        const space = PAGE_UNITS - current.units;
        if (space < GROUP_OVERHEAD + MIN_SPLIT) {
          if (current.groups.length) {
            pages.push(current);
            current = { groups: [], units: 0 };
          }
          continue;
        }

        const capacity = Math.floor(space - GROUP_OVERHEAD);
        const take = Math.min(remaining.length, capacity);
        if (take <= 0) {
          pages.push(current);
          current = { groups: [], units: 0 };
          continue;
        }

        const chunkRows = remaining.slice(0, take);
        current.groups.push({
          subject: group.subject,
          rows: chunkRows,
          continuation: chunkIndex > 0,
          minutes: chunkRows.reduce(function (sum, r) {
            return sum + r.session.minutes;
          }, 0),
        });
        current.units += GROUP_OVERHEAD + take;
        remaining = remaining.slice(take);
        chunkIndex += 1;

        if (remaining.length) {
          pages.push(current);
          current = { groups: [], units: 0 };
        }
      }
    });

    if (current.groups.length) pages.push(current);
    return pages;
  }

  function subjectGroupHtml(group, isFuture) {
    const subject = group.subject;
    const color = subject
      ? normalizeHex(subject.color) || DEFAULT_COLOR
      : '#eeeeea';
    const textColor = subject ? readableText(color) : '#77776f';
    const name = subject ? esc(subject.name) : '未分类';
    return (
      '<section class="subject-group">' +
      '<div class="subject-group-head">' +
      '<div class="subject-group-name">' +
      '<span class="subject-group-tag" style="background:' +
      color +
      ';color:' +
      textColor +
      '">' +
      name +
      '</span>' +
      (group.continuation ? '<span class="group-cont">（续）</span>' : '') +
      '</div>' +
      '<div class="subject-group-time">建议用时 ' +
      Math.round(group.minutes) +
      ' 分钟</div>' +
      '</div>' +
      '<div class="subject-group-rows">' +
      group.rows
        .map(function (item) {
          return todayRowHtml(item, isFuture);
        })
        .join('') +
      '</div>' +
      '</section>'
    );
  }

  function renderToday() {
    const root = $('#view-today');
    const today = todayStr();
    const date = ui.date || today;
    const isToday = date === today;
    const isFuture = date > today;

    const rows = [];
    state.entries.forEach(function (entry) {
      const s = pendingSession(entry, date);
      if (s) rows.push({ entry: entry, session: s });
    });
    rows.sort(function (a, b) {
      return (
        b.session.overdue - a.session.overdue ||
        a.session.date.localeCompare(b.session.date) ||
        a.entry.name.localeCompare(b.entry.name, 'zh-CN')
      );
    });

    const totalMinutes = rows.reduce(function (sum, r) {
      return sum + r.session.minutes;
    }, 0);
    const overdueCount = rows.filter(function (r) {
      return r.session.overdue > 0;
    }).length;

    const doneRows = [];
    state.entries.forEach(function (entry) {
      completedSessionsOn(entry, date).forEach(function (s) {
        doneRows.push({ entry: entry, session: s });
      });
    });
    doneRows.sort(function (a, b) {
      return (
        a.entry.name.localeCompare(b.entry.name, 'zh-CN') || a.session.n - b.session.n
      );
    });

    const groups = groupPendingRows(rows);
    const pages = paginateGroups(groups);
    const pageCount = Math.max(1, pages.length);

    const toolbar =
      '<div class="toolbar no-print">' +
      '<label class="inline-field">查看日期' +
      '<input type="date" class="date-input" id="today-date" value="' +
      esc(date) +
      '">' +
      '</label>' +
      '<button type="button" class="btn btn-small" data-action="today-reset"' +
      (isToday ? ' disabled' : '') +
      '>回到今天</button>' +
      '<span class="stat-line">待复习 <strong>' +
      rows.length +
      '</strong> 条 · 建议总用时 <strong>' +
      Math.round(totalMinutes) +
      ' 分钟</strong>' +
      (overdueCount
        ? ' · <span class="overdue-strong">逾期 ' + overdueCount + ' 条</span>'
        : '') +
      '</span>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-primary" data-action="print">打印 / 导出 PDF</button>' +
      '</div>';

    let pagesHtml = '';
    if (!rows.length) {
      pagesHtml =
        '<div class="paper">' +
        paperHeadHtml(date, isToday, rows, totalMinutes, overdueCount, 1, 1) +
        emptyPaperHtml(isToday, doneRows.length) +
        '</div>';
    } else {
      pages.forEach(function (page, p) {
        const bodyHtml =
          '<div class="paper-body">' +
          page.groups
            .map(function (group) {
              return subjectGroupHtml(group, isFuture);
            })
            .join('') +
          '</div>';
        pagesHtml +=
          '<div class="paper">' +
          paperHeadHtml(date, isToday, rows, totalMinutes, overdueCount, p + 1, pageCount) +
          bodyHtml +
          '</div>';
      });
    }

    let doneHtml = '';
    if (doneRows.length) {
      doneHtml =
        '<details class="done-panel">' +
        '<summary>' +
        (isToday ? '今日' : '该日') +
        '已完成 ' +
        doneRows.length +
        ' 条</summary>' +
        '<ul class="done-list">' +
        doneRows
          .map(function (r) {
            return (
              '<li>' +
              '<span class="done-name">' +
              esc(r.entry.name) +
              subjectTag(r.entry.subjectId) +
              '</span>' +
              '<span class="done-meta">第 ' +
              r.session.n +
              ' 次 · ' +
              fmtMinutes(r.session.minutes) +
              ' · ' +
              fmtShort(r.entry.done[r.session.n]) +
              ' 完成</span>' +
              '<button type="button" class="btn btn-small" data-action="undo-session" data-id="' +
              esc(r.entry.id) +
              '" data-n="' +
              r.session.n +
              '">撤销</button>' +
              '</li>'
            );
          })
          .join('') +
        '</ul></details>';
    }

    root.innerHTML = toolbar + pagesHtml + doneHtml;
  }

  function todayRowHtml(item, isFuture) {
    const entry = item.entry;
    const s = item.session;
    return (
      '<div class="today-row">' +
      '<div class="today-name" title="' +
      esc(entry.name) +
      '">' +
      '<span class="name-text">' +
      esc(entry.name) +
      '</span>' +
      (s.overdue
        ? '<span class="overdue-tag">逾期 ' + s.overdue + ' 天</span>'
        : '') +
      '</div>' +
      '<div class="today-minutes">' +
      fmtMinutes(s.minutes) +
      '</div>' +
      '<button type="button" class="today-check" data-action="complete-session" data-id="' +
      esc(entry.id) +
      '" data-n="' +
      s.n +
      '" data-date="' +
      esc(ui.date) +
      '" title="标记完成" aria-label="标记完成：' +
      esc(entry.name) +
      '"' +
      (isFuture ? ' disabled' : '') +
      '>✓</button>' +
      '</div>'
    );
  }

  function emptyPaperHtml(isToday, doneCount) {
    let title;
    let desc;
    let button;
    if (!state.entries.length) {
      if (!activeSubjects().length) {
        title = '还没有科目';
        desc = '先在「科目设置」里建立科目，再回来添加要背的条目。';
        button =
          '<button type="button" class="btn btn-primary no-print" data-action="goto-subjects">去添加科目</button>';
      } else {
        title = '还没有条目';
        desc = '添加条目并填写首次背诵信息后，系统会自动生成后续复习计划。';
        button =
          '<button type="button" class="btn btn-primary no-print" data-action="new-entry">添加第一个条目</button>';
      }
    } else {
      title =
        isToday && doneCount
          ? '今天的复习已经完成'
          : isToday
          ? '今天没有需要复习的条目'
          : '这一天没有需要复习的条目';
      desc =
        '可以用上方的日期查看其他日期；条目到复习日期时会自动出现在这里。';
      button =
        '<button type="button" class="btn no-print" data-action="goto-entries">查看全部条目</button>';
    }
    return (
      '<div class="paper-empty">' +
      '<div class="paper-empty-title">' +
      esc(title) +
      '</div>' +
      '<div class="paper-empty-desc">' +
      esc(desc) +
      '</div>' +
      button +
      '</div>'
    );
  }

  /* ---------------- 渲染：条目管理 ---------------- */
  function renderEntries() {
    const root = $('#view-entries');
    const subjectOptions = state.subjects
      .slice()
      .sort(function (a, b) {
        return (a.archived ? 1 : 0) - (b.archived ? 1 : 0);
      })
      .map(function (s) {
        return (
          '<option value="' +
          esc(s.id) +
          '">' +
          esc(s.name) +
          (s.archived ? '（已停用）' : '') +
          '</option>'
        );
      })
      .join('');

    if (
      ui.subjectFilter !== 'all' &&
      ui.subjectFilter !== '__none__' &&
      !subjectById(ui.subjectFilter)
    ) {
      ui.subjectFilter = 'all';
    }

    root.innerHTML =
      '<div class="view-head">' +
      '<div>' +
      '<h1 class="view-title">条目管理</h1>' +
      '<p class="view-desc">检索、查看、修改或删除条目。修改首次背诵日期或用时会重算后续复习日期，已完成的复习记录会保留。</p>' +
      '</div>' +
      '<button type="button" class="btn btn-primary" data-action="new-entry">添加条目</button>' +
      '</div>' +
      '<div class="toolbar">' +
      '<input type="search" class="text-input" id="entry-search" placeholder="搜索条目名或科目…" value="' +
      esc(ui.search) +
      '" style="width:220px" aria-label="搜索条目">' +
      '<select class="select-input" id="entry-subject-filter" aria-label="按科目筛选">' +
      '<option value="all"' +
      (ui.subjectFilter === 'all' ? ' selected' : '') +
      '>全部科目</option>' +
      subjectOptions +
      (state.entries.some(function (e) {
        return !subjectById(e.subjectId);
      })
        ? '<option value="__none__"' +
          (ui.subjectFilter === '__none__' ? ' selected' : '') +
          '>未分类</option>'
        : '') +
      '</select>' +
      '<select class="select-input" id="entry-sort" aria-label="排序方式">' +
      '<option value="name"' +
      (ui.sort === 'name' ? ' selected' : '') +
      '>按名称</option>' +
      '<option value="first"' +
      (ui.sort === 'first' ? ' selected' : '') +
      '>首次日期（新→旧）</option>' +
      '<option value="next"' +
      (ui.sort === 'next' ? ' selected' : '') +
      '>下次复习（近→远）</option>' +
      '<option value="created"' +
      (ui.sort === 'created' ? ' selected' : '') +
      '>添加时间（新→旧）</option>' +
      '</select>' +
      '<span class="spacer"></span>' +
      '<span class="table-count" id="entry-count"></span>' +
      '</div>' +
      '<div id="entry-table-wrap"></div>';

    renderEntryRows();
  }

  function filteredEntries() {
    let list = state.entries.slice();
    const q = ui.search.trim().toLowerCase();

    if (q) {
      list = list.filter(function (e) {
        return (
          e.name.toLowerCase().indexOf(q) >= 0 ||
          subjectName(e.subjectId).toLowerCase().indexOf(q) >= 0
        );
      });
    }

    if (ui.subjectFilter === '__none__') {
      list = list.filter(function (e) {
        return !subjectById(e.subjectId);
      });
    } else if (ui.subjectFilter !== 'all') {
      list = list.filter(function (e) {
        return e.subjectId === ui.subjectFilter;
      });
    }

    function nextDate(e) {
      const s = nextSession(e);
      return s ? s.date : '9999-99-99';
    }

    list.sort(function (a, b) {
      if (ui.sort === 'first') {
        return b.firstDate.localeCompare(a.firstDate) || a.name.localeCompare(b.name, 'zh-CN');
      }
      if (ui.sort === 'next') {
        return nextDate(a).localeCompare(nextDate(b)) || a.name.localeCompare(b.name, 'zh-CN');
      }
      if (ui.sort === 'created') {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    return list;
  }

  function renderEntryRows() {
    const wrap = $('#entry-table-wrap');
    if (!wrap) return;
    const list = filteredEntries();
    const countEl = $('#entry-count');
    if (countEl) {
      countEl.textContent = '共 ' + list.length + ' 条';
    }

    if (!state.entries.length) {
      wrap.innerHTML =
        '<div class="empty-state">' +
        '<div class="empty-state-title">还没有条目</div>' +
        '<div class="empty-state-desc">先添加科目，再添加要背诵的条目，系统会自动排好复习日期。</div>' +
        '<button type="button" class="btn btn-primary" data-action="new-entry">添加第一个条目</button>' +
        '</div>';
      return;
    }

    if (!list.length) {
      wrap.innerHTML =
        '<div class="empty-state">' +
        '<div class="empty-state-title">没有匹配的条目</div>' +
        '<div class="empty-state-desc">换个关键词或科目筛选试试。</div>' +
        '</div>';
      return;
    }

    const today = todayStr();
    const body = list
      .map(function (entry) {
        const progress = progressOf(entry);
        const next = nextSession(entry);
        let nextHtml;
        if (!next) {
          nextHtml = '<span class="muted">全部完成</span>';
        } else {
          const overdue = next.date < today ? diffDays(next.date, today) : 0;
          nextHtml =
            fmtShort(next.date) +
            (overdue
              ? ' <span class="overdue-tag">逾期 ' + overdue + ' 天</span>'
              : next.date === today
              ? ' <span class="muted">（今天）</span>'
              : '');
        }
        return (
          '<tr>' +
          '<td class="cell-name">' +
          '<button type="button" class="link-btn" data-action="entry-detail" data-id="' +
          esc(entry.id) +
          '" title="查看背诵详情">' +
          esc(entry.name) +
          '</button>' +
          subjectTag(entry.subjectId) +
          '</td>' +
          '<td>' +
          fmtShort(entry.firstDate) +
          '</td>' +
          '<td>' +
          fmtMinutes(entry.firstMinutes) +
          '</td>' +
          '<td>' +
          progress.done +
          ' / ' +
          progress.total +
          ' 次</td>' +
          '<td>' +
          nextHtml +
          '</td>' +
          '<td>' +
          '<div class="cell-actions">' +
          '<button type="button" class="btn btn-small" data-action="entry-detail" data-id="' +
          esc(entry.id) +
          '">详情</button>' +
          '<button type="button" class="btn btn-small" data-action="edit-entry" data-id="' +
          esc(entry.id) +
          '">编辑</button>' +
          '<button type="button" class="btn btn-small btn-danger" data-action="delete-entry" data-id="' +
          esc(entry.id) +
          '">删除</button>' +
          '</div>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    wrap.innerHTML =
      '<div class="table-wrap"><table class="data-table">' +
      '<thead><tr><th>条目</th><th>首次背诵</th><th>首次用时</th><th>进度</th><th>下次复习</th><th class="ta-right">操作</th></tr></thead>' +
      '<tbody>' +
      body +
      '</tbody></table></div>';
  }

  /* ---------------- 渲染：科目设置 ---------------- */
  function presetColorButtons(selected) {
    const current = normalizeHex(selected) || DEFAULT_COLOR;
    return PRESET_COLORS.map(function (color) {
      return (
        '<button type="button" class="color-choice' +
        (color === current ? ' selected' : '') +
        '" data-color="' +
        color +
        '" style="background:' +
        color +
        '" title="预设颜色 ' +
        color +
        '" aria-label="预设颜色 ' +
        color +
        '"></button>'
      );
    }).join('');
  }

  function colorPickerHtml(selected) {
    const color = normalizeHex(selected) || DEFAULT_COLOR;
    return (
      '<div class="preset-colors">' +
      presetColorButtons(color) +
      '</div>' +
      '<label class="custom-color" title="打开取色器自定义颜色">' +
      '<input type="color" name="color" value="' +
      color +
      '" aria-label="自定义标签颜色">' +
      '<span>自定义</span>' +
      '</label>' +
      '<span class="color-preview subject-tag" style="background:' +
      color +
      ';color:' +
      readableText(color) +
      '">科目</span>'
    );
  }

  function updateColorPicker(form) {
    const input = form.querySelector('input[name="color"]');
    if (!input) return;
    const color = normalizeHex(input.value) || DEFAULT_COLOR;
    form.querySelectorAll('[data-color]').forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.color === color);
    });
    const preview = form.querySelector('.color-preview');
    if (preview) {
      preview.style.background = color;
      preview.style.color = readableText(color);
    }
  }

  function pickDefaultColor() {
    const used = new Set(
      state.subjects.map(function (s) {
        return normalizeHex(s.color);
      })
    );
    for (let i = 0; i < PRESET_COLORS.length; i++) {
      if (!used.has(PRESET_COLORS[i])) return PRESET_COLORS[i];
    }
    return PRESET_COLORS[state.subjects.length % PRESET_COLORS.length];
  }

  function renderSubjects() {
    const root = $('#view-subjects');
    const list = state.subjects.slice().sort(function (a, b) {
      return (a.archived ? 1 : 0) - (b.archived ? 1 : 0) ||
        (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    let tableHtml;
    if (!list.length) {
      tableHtml =
        '<div class="empty-state">' +
        '<div class="empty-state-title">还没有科目</div>' +
        '<div class="empty-state-desc">在上方输入科目名称并选一个标签颜色，就可以开始添加条目了。</div>' +
        '</div>';
    } else {
      tableHtml =
        '<div class="table-wrap"><table class="data-table">' +
        '<thead><tr><th>科目</th><th>条目数</th><th>状态</th><th class="ta-right">操作</th></tr></thead><tbody>' +
        list
          .map(function (s) {
            const color = normalizeHex(s.color) || DEFAULT_COLOR;
            const count = subjectEntryCount(s.id);
            return (
              '<tr' +
              (s.archived ? ' class="subject-archived"' : '') +
              '>' +
              '<td><span class="color-dot" style="background:' +
              color +
              '"></span>' +
              esc(s.name) +
              '</td>' +
              '<td>' +
              count +
              ' 条</td>' +
              '<td>' +
              (s.archived
                ? '<span class="status-pill">已停用</span>'
                : '<span class="status-pill">使用中</span>') +
              '</td>' +
              '<td><div class="cell-actions">' +
              '<button type="button" class="btn btn-small" data-action="edit-subject" data-id="' +
              esc(s.id) +
              '">编辑</button>' +
              (s.archived
                ? '<button type="button" class="btn btn-small" data-action="restore-subject" data-id="' +
                  esc(s.id) +
                  '">恢复</button>'
                : '<button type="button" class="btn btn-small" data-action="archive-subject" data-id="' +
                  esc(s.id) +
                  '">停用</button>') +
              (count === 0
                ? '<button type="button" class="btn btn-small btn-danger" data-action="delete-subject" data-id="' +
                  esc(s.id) +
                  '">删除</button>'
                : '') +
              '</div></td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';
    }

    root.innerHTML =
      '<div class="view-head">' +
      '<div>' +
      '<h1 class="view-title">科目设置</h1>' +
      '<p class="view-desc">科目用于给条目分类打标签。停用科目不会影响已有条目，只是新条目不能再选择它。</p>' +
      '</div>' +
      '</div>' +
      '<form id="subject-form" class="subject-create" autocomplete="off">' +
      '<div class="create-row">' +
      '<input type="text" class="text-input" name="name" maxlength="20" placeholder="新科目名称，例如：英语" required aria-label="新科目名称">' +
      '<button type="submit" class="btn btn-primary">添加科目</button>' +
      '</div>' +
      '<div class="color-picker">' +
      '<span class="color-picker-label">标签颜色</span>' +
      colorPickerHtml(pickDefaultColor()) +
      '</div>' +
      '</form>' +
      tableHtml;
  }

  /* ---------------- 渲染：数据备份 ---------------- */
  function renderData() {
    const root = $('#view-data');
    const activeSubjectCount = activeSubjects().length;
    const doneTotal = state.entries.reduce(function (sum, e) {
      return sum + Object.keys(e.done || {}).length;
    }, 0);
    const pendingToday = todayPendingRows().length;
    const sampleFirst = 15;
    const sampleRows = [1, 2, 3, 4, 5, 14]
      .map(function (n) {
        const day =
          n === 1
            ? '首次当天'
            : '第 ' + Math.round(Math.pow(SESSION_BASE, n - 1)) + ' 天';
        const minutes = sampleFirst / Math.sqrt(n);
        return (
          '<tr><td>第 ' +
          n +
          ' 次</td><td>' +
          day +
          '</td><td>' +
          fmtMinutes(minutes) +
          '</td></tr>'
        );
      })
      .join('');

    root.innerHTML =
      '<div class="view-head">' +
      '<div>' +
      '<h1 class="view-title">数据备份</h1>' +
      '<p class="view-desc">查看数据概况、导出备份，以及了解复习规则。</p>' +
      '</div>' +
      '</div>' +
      '<div class="stat-cards">' +
      '<div class="stat-card"><div class="stat-num">' +
      state.entries.length +
      '</div><div class="stat-label">条目总数</div></div>' +
      '<div class="stat-card"><div class="stat-num">' +
      activeSubjectCount +
      '</div><div class="stat-label">使用中的科目</div></div>' +
      '<div class="stat-card"><div class="stat-num">' +
      doneTotal +
      '</div><div class="stat-label">累计复习次数</div></div>' +
      '<div class="stat-card"><div class="stat-num">' +
      pendingToday +
      '</div><div class="stat-label">今日待复习</div></div>' +
      '</div>' +
      '<div class="panel">' +
      '<h2>备份与恢复</h2>' +
      '<p>数据保存在当前浏览器的 localStorage 里，不会上传到任何服务器。更换浏览器、更换设备或清理浏览数据都会导致数据丢失，重要数据请定期导出备份。</p>' +
      '<div class="btn-row">' +
      '<button type="button" class="btn btn-primary" data-action="export">导出备份（JSON）</button>' +
      '<button type="button" class="btn" data-action="import">导入备份…</button>' +
      '<input type="file" id="import-file" accept=".json,application/json" hidden>' +
      '<button type="button" class="btn" data-action="load-demo">载入示例数据</button>' +
      '</div>' +
      '<p class="muted" style="margin-top:10px;font-size:12px">「载入示例数据」会用一组体验数据覆盖当前内容，方便快速查看效果。</p>' +
      '</div>' +
      '<div class="panel">' +
      '<h2>复习规则</h2>' +
      '<p>首次背诵当天记为第 1 天。第 n 次背诵安排在第 <span class="formula">1.7^(n-1)</span> 天（四舍五入），也就是第 2、3、5、8、14、24…… 天。下一次是第 1684 天（约 4.6 年后），已经超过 4 年上限，所以最多安排到第 990 天（约 2.7 年），共 14 次背诵。</p>' +
      '<p>第 n 次的建议用时 = 首次记忆用时 × <span class="formula">n^(-1/2)</span>，即首次用时除以 √n。刚添加时 n=1，建议用时就是首次用时。</p>' +
      '<table class="rule-table"><thead><tr><th>背诵次数</th><th>安排日期</th><th>建议用时（首次 15 分钟为例）</th></tr></thead><tbody>' +
      sampleRows +
      '</tbody></table>' +
      '<p class="muted" style="margin-top:10px;font-size:12px">说明：首次背诵视为已完成，从第 2 次开始进入今日复习清单；如果某次复习逾期未完成，会一直保留在清单里并标注逾期天数。</p>' +
      '</div>' +
      '<div class="panel danger-zone">' +
      '<h2>清空数据</h2>' +
      '<p>删除所有科目、条目和复习记录。此操作不可撤销，建议先导出备份。</p>' +
      '<div class="btn-row"><button type="button" class="btn btn-danger" data-action="clear-all">清空全部数据</button></div>' +
      '</div>';
  }

  /* ---------------- 视图切换 ---------------- */
  function render() {
    if (ui.view === 'today') renderToday();
    else if (ui.view === 'entries') renderEntries();
    else if (ui.view === 'subjects') renderSubjects();
    else renderData();
  }

  function switchView(view) {
    ui.view = view;
    $$('.tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.view === view);
    });
    $$('.view').forEach(function (section) {
      section.hidden = section.id !== 'view-' + view;
    });
    render();
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(html, opts) {
    const options = opts || {};
    const root = $('#modal-root');
    root.innerHTML =
      '<div class="modal-backdrop" data-dismissible="' +
      (options.dismissible === false ? 'false' : 'true') +
      '">' +
      html +
      '</div>';
    document.body.style.overflow = 'hidden';
    const focusable =
      root.querySelector(
        '.modal input:not([type="hidden"]):not([disabled]), .modal select, .modal textarea'
      ) || root.querySelector('.modal button');
    if (focusable) {
      setTimeout(function () {
        try {
          focusable.focus();
        } catch (err) {
          /* 忽略聚焦失败 */
        }
      }, 30);
    }
  }

  function closeModal() {
    $('#modal-root').innerHTML = '';
    document.body.style.overflow = '';
  }

  /* ---------------- 条目表单 ---------------- */
  function openEntryForm(id) {
    const entry = id ? findEntry(id) : null;
    if (id && !entry) {
      toast('条目不存在，可能已被删除。');
      return;
    }

    const subjects = state.subjects.filter(function (s) {
      return !s.archived || (entry && s.id === entry.subjectId);
    });

    if (!subjects.length) {
      toast('请先在「科目设置」中添加一个科目。');
      closeModal();
      switchView('subjects');
      return;
    }

    let selectedId = entry && subjectById(entry.subjectId)
      ? entry.subjectId
      : subjects[0].id;
    if (!subjects.some(function (s) { return s.id === selectedId; })) {
      selectedId = subjects[0].id;
    }

    const subjectOptions = subjects
      .map(function (s) {
        return (
          '<option value="' +
          esc(s.id) +
          '"' +
          (s.id === selectedId ? ' selected' : '') +
          '>' +
          esc(s.name) +
          (s.archived ? '（已停用）' : '') +
          '</option>'
        );
      })
      .join('');

    openModal(
      '<form id="entry-form" class="modal" data-id="' +
        (entry ? esc(entry.id) : '') +
        '" autocomplete="off">' +
        '<div class="modal-head">' +
        '<div><h2 class="modal-title">' +
        (entry ? '编辑条目' : '添加条目') +
        '</h2>' +
        (entry
          ? '<div class="modal-subtitle">修改首次背诵信息会重算后续复习日期。</div>'
          : '<div class="modal-subtitle">首次背诵当天记为第 1 次，从第 2 天开始安排复习。</div>') +
        '</div>' +
        '<button type="button" class="icon-btn" data-close aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="field"><label for="entry-name">条目名</label>' +
        '<input type="text" class="text-input" id="entry-name" name="name" maxlength="100" required placeholder="例如：英语单词 Unit 1" value="' +
        (entry ? esc(entry.name) : '') +
        '"></div>' +
        '<div class="field"><label for="entry-subject">科目</label>' +
        '<select class="select-input" id="entry-subject" name="subjectId" required>' +
        subjectOptions +
        '</select>' +
        '<p class="hint">想增加新科目？先到「科目设置」里添加。</p></div>' +
        '<div class="field"><label for="entry-date">首次背诵日期</label>' +
        '<input type="date" class="date-input" id="entry-date" name="firstDate" required max="' +
        todayStr() +
        '" value="' +
        (entry ? esc(entry.firstDate) : todayStr()) +
        '"></div>' +
        '<div class="field"><label for="entry-minutes">首次记忆用时（分钟）</label>' +
        '<input type="number" class="number-input" id="entry-minutes" name="firstMinutes" min="0.1" max="600" step="0.1" required placeholder="例如：15" value="' +
        (entry ? esc(entry.firstMinutes) : '') +
        '">' +
        '<p class="hint">可以填小数，例如 12.5。建议用时会根据它和背诵次数自动计算。</p></div>' +
        '<p class="form-error" hidden></p>' +
        '</div>' +
        '<div class="modal-foot">' +
        '<button type="button" class="btn" data-close>取消</button>' +
        '<button type="submit" class="btn btn-primary">保存</button>' +
        '</div>' +
        '</form>',
      { dismissible: false }
    );
  }

  function handleEntrySubmit(form) {
    const id = form.dataset.id || null;
    const entry = id ? findEntry(id) : null;
    const name = form.elements.name.value.trim();
    const subjectId = form.elements.subjectId.value;
    const firstDate = form.elements.firstDate.value;
    const firstMinutes = Number(form.elements.firstMinutes.value);
    const errorEl = form.querySelector('.form-error');

    function fail(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      return false;
    }

    errorEl.hidden = true;

    if (!name) return fail('请填写条目名。');
    if (name.length > 100) return fail('条目名不能超过 100 个字符。');
    const subject = subjectById(subjectId);
    if (!subject) return fail('请选择一个科目。');
    if (subject.archived && !(entry && entry.subjectId === subject.id)) {
      return fail('这个科目已停用，请选择其他科目。');
    }
    if (!isValidYmd(firstDate)) return fail('请选择有效的首次背诵日期。');
    if (firstDate > todayStr()) return fail('首次背诵日期不能晚于今天。');
    if (!Number.isFinite(firstMinutes) || firstMinutes <= 0) {
      return fail('首次记忆用时需要大于 0 分钟。');
    }
    if (firstMinutes > 600) return fail('首次记忆用时不能超过 600 分钟。');

    let saved;
    if (entry) {
      entry.name = name;
      entry.subjectId = subject.id;
      entry.firstDate = firstDate;
      entry.firstMinutes = firstMinutes;
      entry.updatedAt = nowIso();

      // 如果修改后的计划变短，清掉超出范围的完成记录
      const maxN = buildPlan(entry)[buildPlan(entry).length - 1].n;
      Object.keys(entry.done || {}).forEach(function (k) {
        if (Number(k) > maxN) delete entry.done[k];
      });
      saved = entry;
    } else {
      saved = {
        id: uid('e'),
        name: name,
        subjectId: subject.id,
        firstDate: firstDate,
        firstMinutes: firstMinutes,
        done: {},
        createdAt: nowIso(),
      };
      state.entries.push(saved);
    }

    saveState();
    closeModal();
    render();

    if (entry) {
      toast('已保存修改。');
    } else {
      const next = nextSession(saved);
      if (!next) {
        toast('已添加条目。');
      } else if (next.date === todayStr()) {
        toast('已添加条目，今天正好有复习安排。');
      } else if (next.date < todayStr()) {
        toast('已添加条目，首次复习日期已过，已列入今日清单。');
      } else {
        toast('已添加条目，下次复习：' + fmtShort(next.date) + '。');
      }
    }
    return true;
  }

  /* ---------------- 条目详情 ---------------- */
  function openEntryDetail(id) {
    const entry = findEntry(id);
    if (!entry) {
      toast('条目不存在，可能已被删除。');
      closeModal();
      return;
    }

    const plan = buildPlan(entry);
    const progress = progressOf(entry);
    const today = todayStr();
    const rows = plan
      .map(function (s) {
        let status;
        let cls = '';
        let actionHtml;
        if (s.n === 1) {
          status = '首次背诵';
          cls = 'is-done';
          actionHtml = '<span class="muted">—</span>';
        } else {
          const doneDate = entry.done && entry.done[s.n];
          if (doneDate) {
            status = '已完成 ' + fmtShort(doneDate);
            cls = 'is-done';
            actionHtml =
              '<button type="button" class="btn btn-small" data-action="undo-session" data-id="' +
              esc(entry.id) +
              '" data-n="' +
              s.n +
              '">撤销</button>';
          } else if (s.date < today) {
            status = '逾期 ' + diffDays(s.date, today) + ' 天';
            cls = 'is-overdue';
            actionHtml =
              '<button type="button" class="btn btn-small btn-primary" data-action="complete-session" data-id="' +
              esc(entry.id) +
              '" data-n="' +
              s.n +
              '">标记完成</button>';
          } else if (s.date === today) {
            status = '今天到期';
            actionHtml =
              '<button type="button" class="btn btn-small btn-primary" data-action="complete-session" data-id="' +
              esc(entry.id) +
              '" data-n="' +
              s.n +
              '">标记完成</button>';
          } else {
            status = '待复习';
            actionHtml =
              '<button type="button" class="btn btn-small" disabled>未到期</button>';
          }
        }
        return (
          '<tr class="' +
          cls +
          '">' +
          '<td>' +
          (s.n === 1 ? '首次' : '第 ' + s.n + ' 次') +
          '</td>' +
          '<td>' +
          fmtShort(s.date) +
          '</td>' +
          '<td>' +
          fmtMinutes(s.minutes) +
          '</td>' +
          '<td>' +
          status +
          '</td>' +
          '<td class="detail-actions">' +
          actionHtml +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    openModal(
      '<div class="modal modal-wide">' +
        '<div class="modal-head">' +
        '<div><h2 class="modal-title">' +
        esc(entry.name) +
        subjectTag(entry.subjectId) +
        '</h2>' +
        '<div class="modal-subtitle">背诵详情与复习计划</div></div>' +
        '<button type="button" class="icon-btn" data-close aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="detail-meta">' +
        '<span>首次背诵：<strong>' +
        fmtShort(entry.firstDate) +
        '</strong></span>' +
        '<span>首次用时：<strong>' +
        fmtMinutes(entry.firstMinutes) +
        '</strong></span>' +
        '<span>进度：<strong>' +
        progress.done +
        ' / ' +
        progress.total +
        ' 次</strong></span>' +
        '<span>科目：<strong>' +
        esc(subjectName(entry.subjectId)) +
        '</strong></span>' +
        '</div>' +
        '<div class="detail-scroll"><table class="detail-table">' +
        '<thead><tr><th>轮次</th><th>复习日期</th><th>建议用时</th><th>状态</th><th class="ta-right">操作</th></tr></thead>' +
        '<tbody>' +
        rows +
        '</tbody></table></div>' +
        '<p class="detail-note">标记完成会记录为今天完成；逾期的复习可以补记。修改首次背诵信息后，未来复习日期会重新计算。</p>' +
        '</div>' +
        '<div class="modal-foot">' +
        '<button type="button" class="btn btn-small btn-danger foot-left" data-action="reset-entry-progress" data-id="' +
        esc(entry.id) +
        '">重置复习进度</button>' +
        '<button type="button" class="btn" data-action="edit-entry" data-id="' +
        esc(entry.id) +
        '">编辑条目</button>' +
        '<button type="button" class="btn btn-primary" data-close>关闭</button>' +
        '</div>' +
        '</div>',
      { dismissible: true }
    );
  }

  /* ---------------- 科目编辑 ---------------- */
  function openSubjectEdit(id) {
    const subject = subjectById(id);
    if (!subject) {
      toast('科目不存在。');
      return;
    }
    openModal(
      '<form id="subject-edit-form" class="modal" data-id="' +
        esc(subject.id) +
        '" autocomplete="off">' +
        '<div class="modal-head">' +
        '<div><h2 class="modal-title">编辑科目</h2>' +
        '<div class="modal-subtitle">改名会同步到所有使用该科目的条目。</div></div>' +
        '<button type="button" class="icon-btn" data-close aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="field"><label for="subject-name-edit">科目名称</label>' +
        '<input type="text" class="text-input" id="subject-name-edit" name="name" maxlength="20" required value="' +
        esc(subject.name) +
        '"></div>' +
        '<div class="field"><span class="field-label">标签颜色</span>' +
        '<div class="color-picker">' +
        colorPickerHtml(subject.color) +
        '</div></div>' +
        '<p class="form-error" hidden></p>' +
        '</div>' +
        '<div class="modal-foot">' +
        '<button type="button" class="btn" data-close>取消</button>' +
        '<button type="submit" class="btn btn-primary">保存</button>' +
        '</div>' +
        '</form>',
      { dismissible: false }
    );
  }

  function handleSubjectEditSubmit(form) {
    const id = form.dataset.id;
    const subject = subjectById(id);
    if (!subject) {
      closeModal();
      return false;
    }
    const name = form.elements.name.value.trim();
    const colorInput = form.querySelector('input[name="color"]');
    const color = normalizeHex(colorInput && colorInput.value) || subject.color;
    const errorEl = form.querySelector('.form-error');

    function fail(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      return false;
    }

    errorEl.hidden = true;
    if (!name) return fail('请填写科目名称。');
    if (name.length > 20) return fail('科目名称不能超过 20 个字符。');
    const duplicate = state.subjects.some(function (s) {
      return s.id !== id && s.name.toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail('已经有同名科目了。');

    subject.name = name;
    subject.color = color;
    saveState();
    closeModal();
    renderSubjects();
    toast('科目已更新。');
    return true;
  }

  /* ---------------- 科目操作 ---------------- */
  function handleSubjectCreate(form) {
    const name = form.elements.name.value.trim();
    const colorInput = form.querySelector('input[name="color"]');
    const color = normalizeHex(colorInput && colorInput.value) || pickDefaultColor();

    if (!name) {
      toast('请填写科目名称。');
      return;
    }
    if (name.length > 20) {
      toast('科目名称不能超过 20 个字符。');
      return;
    }
    if (
      state.subjects.some(function (s) {
        return s.name.toLowerCase() === name.toLowerCase();
      })
    ) {
      toast('已经有同名科目了（可能处于停用状态）。');
      return;
    }

    state.subjects.push({
      id: uid('s'),
      name: name,
      color: color,
      archived: false,
      createdAt: nowIso(),
    });
    saveState();
    renderSubjects();
    toast('已添加科目「' + name + '」。');
    const input = $('#subject-form input[name="name"]');
    if (input) input.focus();
  }

  function archiveSubject(id) {
    const subject = subjectById(id);
    if (!subject) return;
    const count = subjectEntryCount(id);
    const message = count
      ? '停用科目「' +
        subject.name +
        '」后，已有 ' +
        count +
        ' 个条目仍会保留该科目标签，但新条目不能再选择它。确定停用吗？'
      : '确定停用科目「' + subject.name + '」吗？';
    if (!confirm(message)) return;
    subject.archived = true;
    saveState();
    renderSubjects();
    toast('科目已停用。');
  }

  function restoreSubject(id) {
    const subject = subjectById(id);
    if (!subject) return;
    subject.archived = false;
    saveState();
    renderSubjects();
    toast('科目已恢复。');
  }

  function deleteSubject(id) {
    const subject = subjectById(id);
    if (!subject) return;
    const count = subjectEntryCount(id);
    if (count > 0) {
      toast('该科目下还有 ' + count + ' 个条目，不能直接删除；可以停用它。');
      return;
    }
    if (!confirm('确定删除科目「' + subject.name + '」吗？')) return;
    state.subjects = state.subjects.filter(function (s) {
      return s.id !== id;
    });
    saveState();
    renderSubjects();
    toast('科目已删除。');
  }

  /* ---------------- 复习操作 ---------------- */
  function completeSession(id, n, doneDate) {
    const entry = findEntry(id);
    if (!entry) return;
    if (n === 1) return;
    const plan = buildPlan(entry);
    const session = plan.find(function (s) {
      return s.n === n;
    });
    if (!session) return;

    const today = todayStr();
    if (session.date > today) {
      toast('这次复习还没到期，暂时不能标记完成。');
      return;
    }

    let date = doneDate && isValidYmd(doneDate) ? doneDate : today;
    if (date > today) date = today;
    if (date < session.date) {
      toast('完成日期不能早于计划复习日期。');
      return;
    }

    if (!entry.done) entry.done = {};
    entry.done[n] = date;
    entry.updatedAt = nowIso();
    saveState();
    render();
    toast('已完成「' + entry.name + '」第 ' + n + ' 次复习。');
  }

  function undoSession(id, n) {
    const entry = findEntry(id);
    if (!entry || !entry.done || !entry.done[n]) return;
    delete entry.done[n];
    entry.updatedAt = nowIso();
    saveState();
    render();
    toast('已撤销该次复习记录。');
  }

  function resetEntryProgress(id) {
    const entry = findEntry(id);
    if (!entry) return;
    if (
      !confirm(
        '确定清空「' +
          entry.name +
          '」的所有复习记录吗？首次背诵记录会保留，后续复习会重新开始。'
      )
    ) {
      return;
    }
    entry.done = {};
    entry.updatedAt = nowIso();
    saveState();
    render();
    openEntryDetail(id);
    toast('复习进度已重置。');
  }

  function deleteEntry(id) {
    const entry = findEntry(id);
    if (!entry) return;
    if (
      !confirm(
        '确定删除条目「' + entry.name + '」吗？它的复习记录也会一并删除，此操作不可撤销。'
      )
    ) {
      return;
    }
    state.entries = state.entries.filter(function (e) {
      return e.id !== id;
    });
    saveState();
    closeModal();
    render();
    toast('条目已删除。');
  }

  /* ---------------- 备份与示例数据 ---------------- */
  function exportData() {
    const payload = {
      version: 1,
      exportedAt: nowIso(),
      subjects: state.subjects,
      entries: state.entries,
      settings: state.settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '背诵规划表备份-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    toast('备份已导出。');
  }

  function importData(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      let imported;
      try {
        imported = normalizeState(JSON.parse(String(reader.result)));
      } catch (err) {
        alert('导入失败：文件不是有效的备份 JSON。');
        input.value = '';
        return;
      }
      const ok = confirm(
        '将导入 ' +
          imported.subjects.length +
          ' 个科目、' +
          imported.entries.length +
          ' 个条目，并覆盖当前所有数据。确定继续吗？'
      );
      if (!ok) {
        input.value = '';
        return;
      }
      state = imported;
      saveState();
      ui.date = todayStr();
      closeModal();
      switchView('today');
      toast('导入成功。');
      input.value = '';
    };
    reader.onerror = function () {
      alert('读取文件失败，请重试。');
      input.value = '';
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!state.entries.length && !state.subjects.length) {
      toast('当前没有数据。');
      return;
    }
    if (
      !confirm(
        '确定要清空所有科目、条目和复习记录吗？此操作不可撤销，建议先导出备份。'
      )
    ) {
      return;
    }
    const word = prompt('请输入「清空」两个字确认操作：');
    if (word !== '清空') {
      toast('已取消清空。');
      return;
    }
    state = defaultState();
    saveState();
    ui.date = todayStr();
    switchView('today');
    toast('数据已清空。');
  }

  function demoState() {
    const today = todayStr();
    const created = nowIso();
    const defs = [
      ['英语', '#d9e7f2'],
      ['数学', '#ddeada'],
      ['专业课', '#e5deef'],
      ['政治', '#f6e0cd'],
    ];
    const subjects = defs.map(function (d, i) {
      return {
        id: 's_demo_' + i,
        name: d[0],
        color: d[1],
        archived: false,
        createdAt: created,
      };
    });

    // [名称, 科目索引, 首次日期相对今天的天数, 首次用时, 已按时完成的轮次]
    // 新复习节奏下：第 2/3/5/8/14 天分别对应偏移 1/2/4/7/13 天
    const items = [
      ['英语单词 Unit 1', 0, -1, 20, []],
      ['英语单词 Unit 2', 0, -2, 25, [2]],
      ['英语长难句 01', 0, -4, 18, [2, 3]],
      ['英语长难句 02', 0, -7, 24, [2, 3, 4]],
      ['英语作文模板 1', 0, -13, 30, [2, 3, 4, 5]],
      ['英语单词 Unit 3', 0, -2, 22, []],
      ['英语单词 Unit 4', 0, -1, 20, [2]],
      ['英语语法 从句', 0, 0, 28, []],
      ['数学 极限的定义', 1, -1, 15, []],
      ['数学 导数公式表', 1, -2, 30, [2]],
      ['数学 泰勒展开', 1, -4, 35, [2, 3]],
      ['数学 积分表', 1, -7, 40, [2, 3, 4]],
      ['数学 线代 矩阵', 1, -13, 25, [2, 3, 4, 5]],
      ['数学 概率 条件概率', 1, -2, 26, []],
      ['数学 高数 中值定理', 1, -1, 32, [2]],
      ['数学 错题 01', 1, 0, 18, []],
      ['专业课 第一章 框架', 2, -1, 40, []],
      ['专业课 第二章 框架', 2, -2, 35, [2]],
      ['专业课 核心概念 12 个', 2, -4, 30, [2, 3]],
      ['专业课 第三章 重点', 2, -7, 45, [2, 3, 4]],
      ['专业课 名词解释 20 个', 2, -13, 32, [2, 3, 4, 5]],
      ['专业课 简答题 10 个', 2, -2, 38, []],
      ['专业课 论述题 5 个', 2, -1, 42, [2]],
      ['专业课 计算题 6 个', 2, 0, 36, []],
      ['政治 马原 唯物论', 3, -1, 25, []],
      ['政治 马原 辩证法', 3, -2, 28, [2]],
      ['政治 史纲 时间线', 3, -4, 22, [2, 3]],
      ['政治 毛中特 核心', 3, -7, 26, [2, 3, 4]],
      ['政治 时政 专题', 3, -13, 20, [2, 3, 4, 5]],
      ['政治 马原 认识论', 3, -2, 27, []],
      ['政治 思修 基础', 3, -1, 18, [2]],
      ['政治 当代 专题', 3, 0, 15, []],
    ];

    const entries = items.map(function (item, index) {
      const firstDate = addDays(today, item[2]);
      const done = {};
      item[4].forEach(function (n) {
        done[n] =
          addDays(firstDate, Math.round(Math.pow(SESSION_BASE, n - 1)) - 1);
      });
      return {
        id: 'e_demo_' + index,
        name: item[0],
        subjectId: subjects[item[1]].id,
        firstDate: firstDate,
        firstMinutes: item[3],
        done: done,
        createdAt: new Date(Date.now() - index * 60000).toISOString(),
      };
    });

    return {
      version: 1,
      subjects: subjects,
      entries: entries,
      settings: { cols: 3 },
    };
  }

  function loadDemo() {
    if (
      !confirm(
        '载入示例数据会覆盖当前所有科目和条目，确定继续吗？建议先导出备份。'
      )
    ) {
      return;
    }
    state = demoState();
    saveState();
    ui.date = todayStr();
    switchView('today');
    toast('已载入示例数据，可随意修改或清空。');
  }

  /* ---------------- 提示 ---------------- */
  let toastTimer = null;

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 2800);
  }

  /* ---------------- 事件处理 ---------------- */
  function handleAction(action, el) {
    const id = el.dataset.id;
    switch (action) {
      case 'print':
        window.print();
        break;
      case 'today-reset':
        ui.date = todayStr();
        renderToday();
        break;
      case 'goto-entries':
        switchView('entries');
        break;
      case 'goto-subjects':
        switchView('subjects');
        break;
      case 'new-entry':
        openEntryForm(null);
        break;
      case 'edit-entry':
        closeModal();
        openEntryForm(id);
        break;
      case 'delete-entry':
        deleteEntry(id);
        break;
      case 'entry-detail':
        openEntryDetail(id);
        break;
      case 'complete-session': {
        const n = Number(el.dataset.n);
        const doneDate = el.dataset.date || todayStr();
        completeSession(id, n, doneDate);
        if ($('.modal-backdrop')) openEntryDetail(id);
        break;
      }
      case 'undo-session': {
        const n = Number(el.dataset.n);
        undoSession(id, n);
        if ($('.modal-backdrop')) openEntryDetail(id);
        break;
      }
      case 'reset-entry-progress':
        resetEntryProgress(id);
        break;
      case 'edit-subject':
        openSubjectEdit(id);
        break;
      case 'archive-subject':
        archiveSubject(id);
        break;
      case 'restore-subject':
        restoreSubject(id);
        break;
      case 'delete-subject':
        deleteSubject(id);
        break;
      case 'export':
        exportData();
        break;
      case 'import': {
        const input = $('#import-file');
        if (input) input.click();
        break;
      }
      case 'clear-all':
        clearAllData();
        break;
      case 'load-demo':
        loadDemo();
        break;
      default:
        break;
    }
  }

  document.addEventListener('click', function (e) {
    const tab = e.target.closest('.tab');
    if (tab) {
      switchView(tab.dataset.view);
      return;
    }

    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      e.preventDefault();
      closeModal();
      return;
    }

    if (e.target.classList.contains('modal-backdrop')) {
      if (e.target.dataset.dismissible !== 'false') closeModal();
      return;
    }

    const presetColor = e.target.closest('[data-color]');
    if (presetColor) {
      const form = presetColor.closest('form');
      if (form) {
        const input = form.querySelector('input[name="color"]');
        if (input) {
          input.value = presetColor.dataset.color;
          updateColorPicker(form);
        }
      }
      return;
    }

    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      handleAction(actionEl.dataset.action, actionEl);
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'today-date') {
      const value = e.target.value;
      ui.date = isValidYmd(value) ? value : todayStr();
      renderToday();
      return;
    }
    if (e.target.id === 'entry-subject-filter') {
      ui.subjectFilter = e.target.value;
      renderEntryRows();
      return;
    }
    if (e.target.id === 'entry-sort') {
      ui.sort = e.target.value;
      renderEntryRows();
      return;
    }
    if (e.target.id === 'import-file') {
      importData(e.target);
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'entry-search') {
      ui.search = e.target.value;
      renderEntryRows();
      return;
    }
    if (e.target.matches('input[type="color"][name="color"]')) {
      updateColorPicker(e.target.closest('form'));
    }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id === 'entry-form') {
      e.preventDefault();
      handleEntrySubmit(e.target);
      return;
    }
    if (e.target.id === 'subject-form') {
      e.preventDefault();
      handleSubjectCreate(e.target);
      return;
    }
    if (e.target.id === 'subject-edit-form') {
      e.preventDefault();
      handleSubjectEditSubmit(e.target);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('.modal-backdrop')) {
      closeModal();
    }
  });

  // 打印前刷新今日清单，保证从其他页面按 Ctrl+P 时打印的也是最新内容
  window.addEventListener('beforeprint', function () {
    renderToday();
  });

  /* ---------------- 启动 ---------------- */
  function init() {
    $$('.tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.view === 'today');
    });
    renderToday();
    // 支持 #entries / #subjects / #data 直达页面；#new-entry 打开添加表单；#entry=ID 打开条目详情
    const hash = (location.hash || '').replace('#', '');
    if (['entries', 'subjects', 'data'].indexOf(hash) >= 0) {
      switchView(hash);
    } else if (hash === 'new-entry') {
      openEntryForm(null);
    } else if (hash.indexOf('entry=') === 0) {
      openEntryDetail(decodeURIComponent(hash.slice(6)));
    }
  }

  init();
})();
