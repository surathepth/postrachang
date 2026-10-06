/**
 * POSTRACHANG - Cloud Sync Service (Local-First Master with Cloud Sync Queue Bridge)
 * Design Principle:
 * 1. Data on 14" Android POS Local Machine (IndexedDB) is Sovereign Master (ข้อมูลในเครื่องคือหลัก 100%)
 * 2. Works 100% Offline with Zero External Dependencies.
 * 3. When Internet is Available and Cloud Sync is Enabled, seamlessly syncs to Firebase / GitHub.
 */

class CloudSyncService {
  constructor() {
    this.isEnabled = false;
    this.isOnline = navigator.onLine;
    this.firebaseUrl = 'https://kilokamapp-d9128-default-rtdb.asia-southeast1.firebasedatabase.app';
    this.apiKey = 'AIzaSyAd13bqbQHP08lV_q5Yv85BivkImhKJrvE';
    this.syncInterval = null;
    this.isSyncing = false;
    this.pendingCount = 0;

    // Listeners for UI status update
    this.listeners = [];

    // Network status listeners
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notifyStatus('online');
      if (this.isEnabled) this.syncNow();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.notifyStatus('offline');
    });
  }

  onStatusChange(callback) {
    this.listeners.push(callback);
  }

  notifyStatus(extraState = null) {
    const payload = {
      isOnline: this.isOnline,
      isEnabled: this.isEnabled,
      isSyncing: this.isSyncing,
      pendingCount: this.pendingCount,
      state: extraState || (this.isEnabled ? (this.isOnline ? 'synced' : 'offline_pending') : 'local_only'),
      message: this.getStatusMessage()
    };
    this.listeners.forEach(cb => {
      try { cb(payload); } catch (e) { console.error('Sync listener err:', e); }
    });
  }

  getStatusMessage() {
    if (!this.isEnabled) {
      return 'โหมด Local (ข้อมูลเก็บในเครื่อง POS Android 14" เป็นหลัก 100%)';
    }
    if (!this.isOnline) {
      return `ออฟไลน์ (มีรายการรอซิงก์ ${this.pendingCount} รายการ)`;
    }
    if (this.isSyncing) {
      return 'กำลังซิงก์ข้อมูลขึ้นคลาวด์...';
    }
    return 'เชื่อมต่อคลาวด์และซิงก์ข้อมูลสมบูรณ์';
  }

  async init(appDb) {
    this.db = appDb;
    this.isEnabled = await this.db.getSetting('cloud_sync_enabled', false);
    this.firebaseUrl = await this.db.getSetting('firebase_url', 'https://kilokamapp-d9128-default-rtdb.asia-southeast1.firebasedatabase.app');
    this.apiKey = await this.db.getSetting('firebase_api_key', 'AIzaSyAd13bqbQHP08lV_q5Yv85BivkImhKJrvE');

    await this.updatePendingCount();

    if (this.isEnabled) {
      this.startAutoSync();
    } else {
      this.notifyStatus('local_only');
    }
  }

  async setConfig(enabled, firebaseUrl, apiKey) {
    this.isEnabled = Boolean(enabled);
    this.firebaseUrl = (firebaseUrl || '').trim();
    this.apiKey = (apiKey || '').trim();

    await this.db.setSetting('cloud_sync_enabled', this.isEnabled);
    await this.db.setSetting('firebase_url', this.firebaseUrl);
    await this.db.setSetting('firebase_api_key', this.apiKey);

    if (this.isEnabled) {
      this.startAutoSync();
      if (this.isOnline) this.syncNow();
    } else {
      this.stopAutoSync();
      this.notifyStatus('local_only');
    }
  }

  startAutoSync() {
    this.stopAutoSync();
    // Check and sync every 30 seconds if online
    this.syncInterval = setInterval(() => {
      if (this.isOnline && this.isEnabled && !this.isSyncing) {
        this.syncNow();
      }
    }, 30000);
    this.notifyStatus();
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async updatePendingCount() {
    if (!this.db) return 0;
    try {
      const pendingItems = await this.db.getPendingSyncItems();
      this.pendingCount = pendingItems.length;
      return this.pendingCount;
    } catch (e) {
      this.pendingCount = 0;
      return 0;
    }
  }

  // Queue an action from local mutations (Sales, Stock Moves, Customer Debt, etc.)
  async queueChange(tableName, action, recordId, data) {
    if (!this.db) return;
    try {
      await this.db.add('sync_queue', {
        table_name: tableName,
        action: action, // 'insert' | 'update' | 'delete'
        record_id: recordId,
        data: data,
        status: 'pending',
        timestamp: new Date().toISOString()
      });
      await this.updatePendingCount();
      this.notifyStatus();

      // If online and cloud sync is enabled, trigger immediate background sync
      if (this.isEnabled && this.isOnline && !this.isSyncing) {
        this.syncNow();
      }
    } catch (err) {
      console.warn('Queue sync change error:', err);
    }
  }

  // Process pending items and upload to Firebase Realtime DB REST API
  async syncNow() {
    if (!this.isEnabled) {
      this.notifyStatus('local_only');
      return { success: true, message: 'ระบบทำงานในโหมด Local เท่านั้นตามที่กำหนด' };
    }

    if (!this.isOnline) {
      this.notifyStatus('offline_pending');
      return { success: false, message: 'ไม่พบสัญญาณอินเทอร์เน็ต ข้อมูลปลอดภัยอยู่ในเครื่อง' };
    }

    if (!this.firebaseUrl) {
      this.notifyStatus('config_missing');
      return { success: false, message: 'ยังไม่ได้ระบุ Firebase URL' };
    }

    if (this.isSyncing) return;

    this.isSyncing = true;
    this.notifyStatus('syncing');

    try {
      const pendingItems = await this.db.getPendingSyncItems();
      let syncedCount = 0;

      for (const item of pendingItems) {
        try {
          const endpoint = `${this.firebaseUrl.replace(/\/+$/, '')}/${item.table_name}/${item.record_id || Date.now()}.json${this.apiKey ? '?auth=' + this.apiKey : ''}`;
          
          let method = 'PUT';
          if (item.action === 'delete') method = 'DELETE';

          const res = await fetch(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: item.action === 'delete' ? null : JSON.stringify(item.data)
          });

          if (res.ok) {
            await this.db.markSynced(item.id);
            syncedCount++;
          }
        } catch (itemErr) {
          console.warn(`Sync failed for item ${item.id}:`, itemErr);
          // Stop on network failure to avoid hammering
          break;
        }
      }

      await this.updatePendingCount();
      this.isSyncing = false;
      this.notifyStatus('synced');

      return {
        success: true,
        syncedCount: syncedCount,
        remainingPending: this.pendingCount
      };

    } catch (err) {
      this.isSyncing = false;
      this.notifyStatus('sync_error');
      console.error('Cloud sync execution error:', err);
      return { success: false, error: err.message };
    }
  }
}

// Global Singleton Instance
window.cloudSyncService = new CloudSyncService();
