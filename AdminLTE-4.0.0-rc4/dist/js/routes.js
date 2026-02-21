/**
 * Tetra 중앙 집중식 라우팅 맵 (Plan B - 1)
 * href 직접 타이핑 대신 변수 사용 → 오타 원천 방지
 */
(function () {
  const ROUTES = {
    HOME: './home.html',
    HOME_ADMIN: './home_admin.html',
    HOME_MANAGER: './home_manager.html',
    WORKER_HOME: './worker_home.html',
    LOGIN: './login.html',
    /* Admin 전용 */
    ADMIN: './admin.html',
    ADMIN_APPROVAL: './admin.html#approval',
    ADMIN_REVENUE: './admin.html#revenue',
    ADMIN_MEMBERS: './admin_members.html',
    ADMIN_REVENUE_APPROVAL: './admin_revenue.html',
    EXPENSE_MANAGEMENT: './expense_management.html',
    SHARE_MANAGEMENT: './share_management.html',
    DIVIDEND_CALCULATOR: './dividend_calculator.html',
    STAFF_MANAGEMENT: './staff_management.html',
    /* Manager 전용 */
    MANAGER: './manager.html',
    MANAGER_REVENUE: './manager_revenue.html',
    EXPENSE_REGISTRATION: './manager_expense.html',
    MANAGER_MEMBERS: './manager_members.html',
    /* 공통 */
    NOTICES: './notices.html',
    WORKER: './worker.html',
    FORBIDDEN_403: './403.html'
  };

  window.TetraRoutes = ROUTES;
})();
