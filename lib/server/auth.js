import { cookies } from "next/headers";
import {
  getDefaultSessionUser,
  getUserById,
  getUserForRole,
} from "@/lib/server/prototype-store";

export const SESSION_COOKIE_NAME = "synaptos_session";

export function setSessionCookie(response, userId) {
  response.cookies.set(SESSION_COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

export async function getSessionUserFromRequest(request) {
  const userId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!userId) {
    return getDefaultSessionUser();
  }

  return (await getUserById(userId)) ?? getDefaultSessionUser();
}

export async function getSessionUserFromServer() {
  const cookieStore = await cookies();
  const userId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!userId) {
    return getDefaultSessionUser();
  }

  return (await getUserById(userId)) ?? getDefaultSessionUser();
}

export async function resolveLoginUser(role, storeId) {
  return getUserForRole(role, storeId);
}

export function canAccessStore(user, storeId) {
  return user?.role === "admin" || user?.storeId === storeId;
}

export function assertStoreAccess(user, storeId) {
  if (!canAccessStore(user, storeId)) {
    const error = new Error("FORBIDDEN");
    error.code = "FORBIDDEN";
    throw error;
  }
}

export function assertCanApprove(user, storeId) {
  if (!user || !["admin", "manager"].includes(user.role) || !canAccessStore(user, storeId)) {
    const error = new Error("FORBIDDEN");
    error.code = "FORBIDDEN";
    throw error;
  }
}

export function assertCanReject(user, storeId) {
  assertCanApprove(user, storeId);
}

export function assertCanDispatch(user, route, storeId) {
  const permittedRolesByRoute = {
    label: ["admin", "manager"],
    approval: ["admin", "manager"],
    logistics: ["admin", "logistics_coordinator"],
    procurement: ["admin", "procurement_planner"],
  };

  const permittedRoles = permittedRolesByRoute[route] ?? ["admin"];
  const hasRole = user && permittedRoles.includes(user.role);
  const hasStoreAccess =
    user?.role === "admin" ||
    !storeId ||
    user?.storeId === storeId ||
    ["procurement_planner", "logistics_coordinator"].includes(user?.role);

  if (!hasRole || !hasStoreAccess) {
    const error = new Error("FORBIDDEN");
    error.code = "FORBIDDEN";
    throw error;
  }
}

export function assertLogisticsAccess(user, storeId = null) {
  if (
    !user ||
    !["admin", "logistics_coordinator"].includes(user.role) ||
    (storeId &&
      user.role !== "admin" &&
      user.storeId &&
      user.storeId !== storeId)
  ) {
    const error = new Error("FORBIDDEN");
    error.code = "FORBIDDEN";
    throw error;
  }
}

export function assertProcurementAccess(user, storeId = null) {
  if (
    !user ||
    !["admin", "procurement_planner"].includes(user.role) ||
    (storeId &&
      user.role !== "admin" &&
      user.storeId &&
      user.storeId !== storeId)
  ) {
    const error = new Error("FORBIDDEN");
    error.code = "FORBIDDEN";
    throw error;
  }
}

export function assertAdmin(user) {
  if (!user || user.role !== "admin") {
    const error = new Error("FORBIDDEN");
    error.code = "FORBIDDEN";
    throw error;
  }
}
