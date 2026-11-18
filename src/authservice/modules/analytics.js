/**
 * @fileoverview Auth Analytics Module
 * Collects login activity metrics keyed by email without mutating provider logic.
 */

'use strict';

class AuthAnalytics {
  constructor(eventEmitter) {
    /** @private @const {Map<string, {
     *   email: string,
     *   loginCount: number,
     *   failedCount: number,
     *   lastLoginAt: number|null,
     *   lastLoginIso: string|null
     * }>} */
    this.userStats_ = new Map();
    this.eventEmitter_ = eventEmitter;

    if (eventEmitter) {
      this.bindEvents_(eventEmitter);
    }
  }

  bindEvents_(eventEmitter) {
    // Store listener references so they can be removed in destroy() (P2-6).
    this.listeners_ = {
      'auth:login': ({ email }) => this.recordLogin(email),
      'auth:login-failed': ({ email }) => this.recordFailure(email),
      'auth:logout': ({ email }) => this.ensureUser_(email),
      'auth:user-created': ({ email }) => this.ensureUser_(email),
      'auth:user-deleted': ({ email }) => {
        if (email && this.userStats_.has(email)) {
          this.userStats_.delete(email);
        }
      }
    };

    for (const [event, handler] of Object.entries(this.listeners_)) {
      eventEmitter.on(event, handler);
    }
  }

  /**
   * Removes all event listeners registered by this analytics module (P2-6).
   */
  destroy() {
    if (this.eventEmitter_ && this.listeners_) {
      for (const [event, handler] of Object.entries(this.listeners_)) {
        this.eventEmitter_.removeListener(event, handler);
      }
      this.listeners_ = null;
    }
  }

  ensureUser_(email) {
    if (!email) {
      return null;
    }

    let stats = this.userStats_.get(email);
    if (!stats) {
      stats = {
        email,
        loginCount: 0,
        failedCount: 0,
        lastLoginAt: null,
        lastLoginIso: null
      };
      this.userStats_.set(email, stats);
    }
    return stats;
  }

  recordLogin(email) {
    const stats = this.ensureUser_(email);
    if (!stats) {
      return;
    }
    stats.loginCount += 1;
    const now = Date.now();
    stats.lastLoginAt = now;
    stats.lastLoginIso = new Date(now).toISOString();
  }

  recordFailure(email) {
    const stats = this.ensureUser_(email);
    if (!stats) {
      return;
    }
    stats.failedCount += 1;
  }

  getTopUsers(limit = 10) {
    const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
    return [...this.userStats_.values()]
      .sort((a, b) => {
        if (b.loginCount !== a.loginCount) {
          return b.loginCount - a.loginCount;
        }
        const aTime = a.lastLoginAt || 0;
        const bTime = b.lastLoginAt || 0;
        return bTime - aTime;
      })
      .slice(0, effectiveLimit)
      .map((stats) => ({
        email: stats.email,
        loginCount: stats.loginCount,
        failedCount: stats.failedCount,
        lastLogin: stats.lastLoginIso
      }));
  }

  getTopByRecency(limit = 100) {
    const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
    return [...this.userStats_.values()]
      .sort((a, b) => {
        const aTime = a.lastLoginAt || 0;
        const bTime = b.lastLoginAt || 0;
        if (bTime !== aTime) {
          return bTime - aTime;
        }
        return b.loginCount - a.loginCount;
      })
      .slice(0, effectiveLimit)
      .map((stats) => ({
        email: stats.email,
        loginCount: stats.loginCount,
        failedCount: stats.failedCount,
        lastLogin: stats.lastLoginIso
      }));
  }

  getOverview() {
    let totalLogins = 0;
    let totalFailures = 0;
    let recent = 0;

    this.userStats_.forEach((stats) => {
      totalLogins += stats.loginCount;
      totalFailures += stats.failedCount;
      if (stats.lastLoginAt && stats.lastLoginAt > recent) {
        recent = stats.lastLoginAt;
      }
    });

    return {
      totalUsers: this.userStats_.size,
      totalLogins,
      totalFailures,
      lastLoginAt: recent ? new Date(recent).toISOString() : null,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = AuthAnalytics;
