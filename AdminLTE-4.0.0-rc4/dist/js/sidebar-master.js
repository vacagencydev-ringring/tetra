/**
 * Tetra 마스터 사이드바 - Single Source of Truth
 * 권한별 메뉴 렌더링, 경영 전략(Executive) / 현장 운영(Manager) 2그룹 고정
 * routes.js 의 TetraRoutes 사용 (오타 방지)
 */
(function () {
  var R = window.TetraRoutes || {};
  var _ = function (k, d) { return (R[k] != null ? R[k] : d) || d; };

  var MENU_CONFIG = {
    home: { nav: 'home', href: '', icon: 'bi-house-door-fill', label: '홈' },
    executive: {
      title: '경영 전략 (EXECUTIVE)',
      role: 'Admin',
      items: [
        { nav: 'admin#revenue', href: _('ADMIN_REVENUE', './admin.html#revenue'), icon: 'bi-graph-up-arrow', label: '수익 통계' },
        { nav: 'admin_pl_statement', href: './admin_pl_statement.html', hardNav: true, icon: 'bi-calculator', label: '손익계산서' },
        { nav: 'admin_revenue', href: _('ADMIN_REVENUE_APPROVAL', './admin_revenue.html'), icon: 'bi-currency-exchange', label: '매출 승인', badgeId: 'pending-count-badge', badgeText: '0' },
        { nav: 'admin_revenue_ledger', href: './admin_revenue_ledger.html', hardNav: true, icon: 'bi-journal-bookmark-fill', label: '매출장부' },
        { nav: 'expense_management', href: _('EXPENSE_MANAGEMENT', './expense_management.html'), icon: 'bi-wallet2', label: '지출 관리' },
        { nav: 'share_management', href: _('SHARE_MANAGEMENT', './share_management.html'), icon: 'bi-diagram-3-fill', label: '지분 관리' },
        { nav: 'staff_salary', href: './staff_salary.html', hardNav: true, icon: 'bi-cash-stack', label: '급여 관리' },
        { nav: 'dividend', href: _('DIVIDEND_CALCULATOR', './dividend_calculator.html'), icon: 'bi-percent', label: '주주 배당 계산기' },
        { nav: 'admin#approval', href: _('ADMIN_APPROVAL', './admin.html#approval'), icon: 'bi-person-check-fill', label: '가입 승인' },
        { nav: 'admin_members', href: _('ADMIN_MEMBERS', './admin_members.html'), icon: 'bi-people-fill', label: '회원 목록' },
        { nav: 'staff_management', href: _('STAFF_MANAGEMENT', './staff_management.html'), icon: 'bi-person-lines-fill', label: '직원 관리' }
      ]
    },
    manager: {
      title: '현장 운영 (MANAGER)',
      role: 'Manager',
      items: [
        { nav: 'expense_registration', href: './manager_expense.html', hardNav: true, icon: 'bi-wallet2', label: '지출 등록' },
        { nav: 'manager_revenue', href: './manager_revenue.html', hardNav: true, icon: 'bi-currency-exchange', label: '매출(환전) 등록' },
        { nav: 'manager_farming_deduction', href: './manager_farming_deduction.html', hardNav: true, icon: 'bi-dash-circle', label: '환전 차감' },
        { nav: 'manager_worker_revenue', href: './manager_worker_revenue.html', hardNav: true, icon: 'bi-graph-up', label: '워커별 매출 조회' },
        { nav: 'manager_members', href: _('MANAGER_MEMBERS', './manager_members.html'), icon: 'bi-people-fill', label: '회원 목록' },
        { nav: 'manager', href: _('MANAGER', './manager.html'), icon: 'bi-clock-history', label: '근태 관리' },
        { nav: 'worker_daily_tasks', href: './worker_daily_tasks.html', hardNav: true, icon: 'bi-list-check', label: '일일업무' },
        { nav: 'notices', href: _('NOTICES', './notices.html'), icon: 'bi-megaphone-fill', label: '공지 게시판', badgeId: 'nav-notices-badge' }
      ]
    },
    worker: {
      title: '워커',
      items: [
        { nav: 'worker', href: _('WORKER', './worker.html'), icon: 'bi-person-badge', label: 'Worker Portal' },
        { nav: 'notices', href: _('NOTICES', './notices.html'), icon: 'bi-megaphone-fill', label: '공지 게시판', badgeId: 'nav-notices-badge' }
      ]
    }
  };

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }
  function escapeAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function buildNavItem(item) {
    let badge = '';
    if (item.badgeId) {
      if (item.badgeText !== undefined) {
        badge = '<span class="badge nav-badge nav-badge-count bg-danger" id="' + item.badgeId + '">' + escapeHtml(item.badgeText) + '</span>';
      } else {
        badge = '<span class="badge-new d-none" id="' + item.badgeId + '" aria-label="새 공지"></span>';
      }
    }
    var href = escapeHtml(item.href || '');
    if (item.hardNav && href) {
      return '<li class="nav-item nav-menu-item" data-nav="' + escapeHtml(item.nav) + '"><button type="button" class="nav-link nav-button-style nav-hard-nav border-0 bg-transparent w-100 text-start" data-href="' + escapeAttr(href) + '" style="cursor:pointer;outline:none"><i class="nav-icon bi ' + escapeHtml(item.icon) + '"></i><p>' + escapeHtml(item.label) + '</p>' + badge + '</button></li>';
    }
    return '<li class="nav-item nav-menu-item" data-nav="' + escapeHtml(item.nav) + '"><a href="' + href + '" class="nav-link"><i class="nav-icon bi ' + escapeHtml(item.icon) + '"></i><p>' + escapeHtml(item.label) + '</p>' + badge + '</a></li>';
  }

  function buildGroup(config, groupId) {
    const itemsHtml = (config.items || []).map(buildNavItem).join('');
    return (
      '<div class="nav-sidebar-group nav-' + groupId + '-group" data-role="' + (config.role || '') + '">' +
      '<div class="nav-category tetra-nav-category" data-accordion-toggle data-accordion-id="' + groupId + '">' + escapeHtml(config.title) + '<i class="bi bi-chevron-down nav-accordion-chevron ms-auto"></i></div>' +
      '<ul class="nav sidebar-menu flex-column nav-accordion-content" role="navigation" data-accordion="false">' +
      itemsHtml +
      '</ul></div>'
    );
  }

  function renderMasterSidebar(container) {
    if (!container) return;
    const role = localStorage.getItem('role') || '';
    const isAdmin = role === 'Admin';
    const isManager = role === 'Manager';
    const isWorker = role === 'Worker';

    var homeHref = role === 'Admin' ? _('HOME_ADMIN', './home_admin.html') : role === 'Manager' ? _('HOME_MANAGER', './home_manager.html') : role === 'Worker' ? _('WORKER_HOME', './worker_home.html') : _('HOME', './home.html');
    var groupsHtml = '<ul class="nav sidebar-menu flex-column mb-1" role="navigation"><li class="nav-item nav-menu-item" data-nav="home"><a href="' + homeHref + '" class="nav-link"><i class="nav-icon bi bi-house-door-fill"></i><p>홈</p></a></li></ul>';

    if (isAdmin) {
      groupsHtml += buildGroup(MENU_CONFIG.executive, 'executive');
    }
    if (isAdmin || isManager) {
      groupsHtml += buildGroup(MENU_CONFIG.manager, 'manager');
    } else if (isWorker) {
      groupsHtml += buildGroup(MENU_CONFIG.worker, 'manager');
    }

    container.innerHTML =
      '<div class="sidebar-brand">' +
      '<a href="' + _('HOME', './home.html') + '" class="brand-link d-flex align-items-center">' +
      '<span class="tetra-logo-icon me-2"><span></span><span></span><span></span><span></span></span>' +
      '<span class="brand-text fw-light">Tetra Portal</span></a></div>' +
      '<div class="sidebar-wrapper">' +
      '<nav class="mt-2" id="main-sidebar-nav">' +
      groupsHtml +
      '</nav></div>';

  }

  window.TetraSidebar = {
    render: function (container) {
      renderMasterSidebar(container);
    }
  };
})();
