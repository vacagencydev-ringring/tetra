/**
 * 고정 마스터 사이드바 (Static Sidebar) - Single Source of Truth
 * TetraSidebar.render() 호출, URL 경로 매칭 Active 상태 (Tetra Emerald)
 */
(function () {
  function getCurrentNav() {
    const path = (location.pathname || '').split('/').pop() || '';
    const hash = (location.hash || '').replace('#', '');
    if (path === '') return 'home';
    if (path === 'home.html' || path === 'home_admin.html' || path === 'home_manager.html') return 'home';
    if (path === 'worker_home.html') return 'worker';
    if (path === 'notices.html') return 'notices';
    if (path === 'admin.html' && hash) return 'admin#' + hash;
    if (path === 'admin.html') return 'admin#approval';
    if (path === 'admin_revenue.html') return 'admin_revenue';
    if (path === 'admin_revenue_ledger.html') return 'admin_revenue_ledger';
    if (path === 'admin_members.html') return 'admin_members';
    if (path === 'admin_pl_statement.html') return 'admin_pl_statement';
    if (path === 'staff_salary.html') return 'staff_salary';
    if (path === 'staff_management.html') return 'staff_management';
    if (path === 'manager.html' && hash === 'members') return 'manager#members';
    if (path === 'manager.html') return 'manager';
    if (path === 'expense_management.html') return 'expense_management';
    if (path === 'expense_registration.html' || path === 'manager_expense.html') return 'expense_registration';
    if (path === 'manager_revenue.html') return 'manager_revenue';
    if (path === 'share_management.html') return 'share_management';
    if (path === 'dividend_calculator.html') return 'dividend';
    if (path === 'worker.html') return 'worker';
    return '';
  }

  function setActiveNav() {
    const nav = getCurrentNav();
    const navEl = document.getElementById('main-sidebar-nav');
    if (navEl) {
      navEl.querySelectorAll('.nav-menu-item').forEach((li) => {
        li.classList.toggle('active', li.dataset.nav === nav);
      });
    }
  }

  function showExecutiveDeniedToast() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container position-fixed top-0 end-0 p-3';
      container.style.zIndex = '1100';
      document.body.appendChild(container);
    }
    const toastEl = document.createElement('div');
    toastEl.className = 'toast align-items-center text-bg-warning border-0 show';
    toastEl.setAttribute('role', 'alert');
    toastEl.innerHTML = '<div class="d-flex"><div class="toast-body"><i class="bi bi-lock-fill me-2"></i>최고 관리자 전용 메뉴입니다.</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    container.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl, { autohide: true, delay: 3000 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
  }

  function initSidebar() {
    const role = localStorage.getItem('role');
    const body = document.body;
    if (role === 'Admin') body.classList.add('role-admin');
    else if (role === 'Manager') body.classList.add('role-manager');
    else if (role === 'Worker') body.classList.add('role-worker');

    var injectEl = document.getElementById('tetra-sidebar-inject');
    if (injectEl && typeof window.TetraSidebar !== 'undefined') {
      window.TetraSidebar.render(injectEl);
    }

    /* Plan B: 매출/지출 등록 강제 이동 - document에 위임하여 모든 스크립트보다 먼저 처리 */
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('#main-sidebar-nav button.nav-hard-nav');
      if (!btn) return;
      var href = btn.getAttribute('data-href');
      if (!href) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      window.location.href = href;
    }, true);

    /* Plan B-2: 미개발 페이지 404 차단 - 링크 클릭 시 HEAD 체크, 404면 모달 표시 후 이동 취소 */
    setTimeout(function () {
      document.querySelectorAll('#main-sidebar-nav a[href*=".html"]').forEach(function (a) {
        var href = (a.getAttribute('href') || '').trim();
        if (!href || href.indexOf('http') === 0 || href.indexOf('//') === 0 || href === '#' || href.indexOf('#') === 0) return;
        var path = href.split('?')[0].split('#')[0];
        if (!path || path === './' || path === '') return;
        if (path.indexOf('manager_revenue.html') >= 0 || path.indexOf('manager_expense.html') >= 0) return;
        var fullUrl;
        try {
          fullUrl = new URL(href, location.href).href;
          if (fullUrl.indexOf(location.origin) !== 0) return;
        } catch (err) { return; }
        a.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          fetch(fullUrl, { method: 'HEAD', cache: 'no-cache' })
            .then(function (res) {
              if (res.status === 404) {
                if (typeof Swal !== 'undefined') {
                  Swal.fire({ icon: 'info', title: '준비 중', text: '현재 개발 중인 페이지입니다.', confirmButtonText: '확인' });
                } else alert('현재 개발 중인 페이지입니다.');
              } else {
                location.href = href;
              }
            })
            .catch(function () { location.href = href; });
        }, true);
      });
    }, 100);

    setActiveNav();
    window.addEventListener('hashchange', setActiveNav);

    var stored = localStorage.getItem('tetra_sidebar_accordion');
    var state = stored ? JSON.parse(stored) : { executive: true, manager: true, finance: true, hr: true, ops: true };
    document.querySelectorAll('.nav-category[data-accordion-toggle]').forEach(function (cat) {
      var id = cat.dataset.accordionId || cat.getAttribute('data-accordion-id');
      var content = cat.nextElementSibling;
      if (!content || !content.classList.contains('nav-accordion-content')) return;
      if (state[id] === false) {
        cat.classList.add('collapsed');
        content.classList.add('collapsed');
      }
      cat.addEventListener('click', function () {
        cat.classList.toggle('collapsed');
        content.classList.toggle('collapsed');
        state[id] = !content.classList.contains('collapsed');
        localStorage.setItem('tetra_sidebar_accordion', JSON.stringify(state));
      });
    });

    /* 공지 게시판 New 뱃지 - 읽지 않은 새 공지 있으면 빨간 점 표시 */
    var badgeEl = document.getElementById('nav-notices-badge');
    if (badgeEl) {
      var apiUrl = document.querySelector('meta[name="tetra-api-url"]')?.content || 'https://script.google.com/macros/s/AKfycbzFf_YuMxN3hkpPW6sFRKoblztRRf9yfrUMo6BJZ-WeFzYUNQHq4FybW3R_LnzwP9IxxA/exec';
      var readKey = 'tetra_notices_read_ids';
      try {
        fetch(apiUrl + '?action=getNoticeList&offset=0&limit=50')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var notices = data.notices || [];
            var readRaw = localStorage.getItem(readKey);
            var readIds = readRaw ? JSON.parse(readRaw) : [];
            var hasUnread = notices.some(function (n) { return readIds.indexOf(n.notice_id) < 0; });
            badgeEl.classList.toggle('d-none', !hasUnread);
          })
          .catch(function () {});
      } catch (e) {}
    }

    /* 매출 승인 대기 뱃지 - Admin일 때만 갱신 */
    if (role === 'Admin') {
      var pendingBadge = document.getElementById('pending-count-badge');
      if (pendingBadge) {
        var apiUrl2 = document.querySelector('meta[name="tetra-api-url"]')?.content || 'https://script.google.com/macros/s/AKfycbzFf_YuMxN3hkpPW6sFRKoblztRRf9yfrUMo6BJZ-WeFzYUNQHq4FybW3R_LnzwP9IxxA/exec';
        fetch(apiUrl2 + '?action=getRevenueLogs&status=pending')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var logs = data.logs || data.data || data.rows || (Array.isArray(data) ? data : []);
            var cnt = Array.isArray(logs) ? logs.length : 0;
            pendingBadge.textContent = cnt;
          })
          .catch(function () {});
      }
    }

    /* Plan B-2: 화면 밀도 조절 (Compact / Comfortable) */
    var densityKey = 'tetra_density';
    var densityBtn = document.getElementById('density-toggle-btn');
    if (densityBtn) {
      if (localStorage.getItem(densityKey) === 'compact') document.body.classList.add('tetra-density-compact');
      densityBtn.addEventListener('click', function () {
        document.body.classList.toggle('tetra-density-compact');
        var isCompact = document.body.classList.contains('tetra-density-compact');
        localStorage.setItem(densityKey, isCompact ? 'compact' : 'comfortable');
        densityBtn.title = isCompact ? '화면 밀도: Compact (Comfortable으로 전환)' : '화면 밀도: Comfortable (Compact로 전환)';
        var icon = densityBtn.querySelector('i');
        if (icon) icon.className = isCompact ? 'bi bi-aspect-ratio-fill' : 'bi bi-aspect-ratio';
      });
      densityBtn.title = document.body.classList.contains('tetra-density-compact') ? '화면 밀도: Compact' : '화면 밀도: Comfortable (90%~100%)';
    }
  }

  document.addEventListener('DOMContentLoaded', initSidebar);
})();
