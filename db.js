/**
 * POSTRACHANG (ร้านหมอน้อยฟู้ด) - Database Core (IndexedDB)
 * 107 หมู่ 9 ตำบลหนองแวง อำเภอนิคมคำสร้อย จังหวัดมุกดาหาร
 * Local-First Master with Immutable Ledger, Dual-Currency & Cloud Sync Queue
 */

const DB_NAME = 'POSTRACHANG_DB';
const DB_VERSION = 4;

class AppDB {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Categories
        if (!db.objectStoreNames.contains('categories')) {
          const store = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: true });
        }

        // 1b. UOMs (Unit of Measure)
        if (!db.objectStoreNames.contains('uoms')) {
          const store = db.createObjectStore('uoms', { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: true });
        }

        // 2. Products (5-tier pricing, UOM, tare weight)
        if (!db.objectStoreNames.contains('products')) {
          const store = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
          store.createIndex('code', 'code', { unique: true });
          store.createIndex('barcode', 'barcode', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('name', 'name', { unique: false });
        }

        // 3. Customers & Debtors (AR)
        if (!db.objectStoreNames.contains('customers')) {
          const store = db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('phone', 'phone', { unique: false });
        }

        // 4. Suppliers & Creditors (AP)
        if (!db.objectStoreNames.contains('suppliers')) {
          const store = db.createObjectStore('suppliers', { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
        }

        // 5. Employees / Users (4-tier RBAC)
        if (!db.objectStoreNames.contains('employees')) {
          const store = db.createObjectStore('employees', { keyPath: 'id', autoIncrement: true });
          store.createIndex('username', 'username', { unique: true });
          store.createIndex('pin', 'pin', { unique: false });
        }

        // 6. Sales Bills
        if (!db.objectStoreNames.contains('sales')) {
          const store = db.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
          store.createIndex('bill_no', 'bill_no', { unique: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('shift_id', 'shift_id', { unique: false });
        }

        // 7. Sale Lines
        if (!db.objectStoreNames.contains('sale_lines')) {
          const store = db.createObjectStore('sale_lines', { keyPath: 'id', autoIncrement: true });
          store.createIndex('sale_id', 'sale_id', { unique: false });
          store.createIndex('product_id', 'product_id', { unique: false });
        }

        // 8. Stock Movement Ledger (13 Movement Types - Immutable)
        if (!db.objectStoreNames.contains('stock_movements')) {
          const store = db.createObjectStore('stock_movements', { keyPath: 'id', autoIncrement: true });
          store.createIndex('product_id', 'product_id', { unique: false });
          store.createIndex('move_type', 'move_type', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('ref_no', 'ref_no', { unique: false });
        }

        // 9. Cash Sessions (Shifts)
        if (!db.objectStoreNames.contains('cash_sessions')) {
          const store = db.createObjectStore('cash_sessions', { keyPath: 'id', autoIncrement: true });
          store.createIndex('shift_no', 'shift_no', { unique: true });
          store.createIndex('status', 'status', { unique: false });
        }

        // 10. Debt Payments (AR/AP settlements)
        if (!db.objectStoreNames.contains('debt_payments')) {
          const store = db.createObjectStore('debt_payments', { keyPath: 'id', autoIncrement: true });
          store.createIndex('customer_id', 'customer_id', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 11. Settings (Key-Value)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // 12. Cloud Sync Queue (Local-First Sync Bridge)
        if (!db.objectStoreNames.contains('sync_queue')) {
          const store = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('table_name', 'table_name', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 13. Purchases & Supplier Invoices (AP - Accounts Payable)
        if (!db.objectStoreNames.contains('purchases')) {
          const store = db.createObjectStore('purchases', { keyPath: 'id', autoIncrement: true });
          store.createIndex('bill_no', 'bill_no', { unique: false });
          store.createIndex('supplier_id', 'supplier_id', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }

        // 14. Purchase Lines (AP Items)
        if (!db.objectStoreNames.contains('purchase_lines')) {
          const store = db.createObjectStore('purchase_lines', { keyPath: 'id', autoIncrement: true });
          store.createIndex('purchase_id', 'purchase_id', { unique: false });
          store.createIndex('product_id', 'product_id', { unique: false });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        try {
          await this.ensureDefaultMasterData();
          await this.autoMigrateToPakseMasterIfMockDetected();
        } catch (e) {
          console.warn('ensureDefaultMasterData warning:', e);
        }
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB Error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async ensureDefaultUomsAndCategories() {
    if (!this.db) return;
    try {
      if (this.db.objectStoreNames.contains('categories')) {
        const cats = await this.getAll('categories');
        const defaultCats = [
          { id: 1, name: 'ลูกชิ้น & ไส้กรอก & หมูยอ', icon: '🍢' },
          { id: 2, name: 'ปลาทู', icon: '🐟' },
          { id: 3, name: 'อาหารทะเลสด & แช่แข็ง', icon: '🦐' },
          { id: 4, name: 'หมูสไลด์ชาบู & เครื่องใน', icon: '🥩' },
          { id: 5, name: 'อาหารแปรรูป & เบ็ดเตล็ด', icon: '🥫' }
        ];
        if (!cats || cats.length === 0) {
          for (const c of defaultCats) await this.put('categories', c);
        } else {
          for (const c of defaultCats) {
            if (!cats.some(existing => existing.name === c.name)) {
              await this.put('categories', c);
            }
          }
        }
      }
      if (this.db.objectStoreNames.contains('uoms')) {
        const uoms = await this.getAll('uoms');
        if (!uoms || uoms.length === 0) {
          const defaultUoms = [
            { id: 1, name: 'กก.', is_weight: true, decimal: 3, desc: 'กิโลกรัม (ชั่งน้ำหนัก)' },
            { id: 2, name: 'แพ็ค', is_weight: false, decimal: 0, desc: 'แพ็ค / ซอง' },
            { id: 3, name: 'ชิ้น', is_weight: false, decimal: 0, desc: 'ชิ้น / อัน' },
            { id: 4, name: 'ถุง', is_weight: false, decimal: 0, desc: 'ถุง' },
            { id: 5, name: 'ลัง', is_weight: false, decimal: 0, desc: 'ลัง / กล่อง' },
            { id: 6, name: 'ถัง', is_weight: false, decimal: 0, desc: 'ถัง' },
            { id: 7, name: 'ขวด', is_weight: false, decimal: 0, desc: 'ขวด' },
            { id: 8, name: 'แผง', is_weight: false, decimal: 0, desc: 'แผง' },
            { id: 9, name: 'ขีด', is_weight: true, decimal: 1, desc: 'ขีด (100 กรัม)' },
            { id: 10, name: 'กรัม', is_weight: true, decimal: 0, desc: 'กรัม' }
          ];
          for (const u of defaultUoms) await this.put('uoms', u);
        }
      }
    } catch (err) {
      console.warn('ensureDefaultUomsAndCategories error:', err);
    }
  }

  // Self-Healing Multi-Store Auto-Seeder: รับประกันความสมบูรณ์ของฐานข้อมูลทุกตาราง (Employees, Customers, Suppliers, Settings)
  async ensureDefaultMasterData() {
    if (!this.db) await this.init();
    try {
      // 1. Categories & UOMs
      await this.ensureDefaultUomsAndCategories();

      // 2. Employees (4-tier RBAC)
      if (this.db.objectStoreNames.contains('employees')) {
        const emps = await this.getAll('employees');
        if (!emps || emps.length === 0) {
          console.log('[DB] สร้างข้อมูลพนักงานและสิทธิ์ 4 ระดับ (RBAC) เริ่มต้น...');
          const defaultEmployees = [
            { id: 1, username: 'admin', name: 'เทพอภัย (ผู้ดูแลระบบ)', role: 'admin', pin: '1234', phone: '089-999-9999', active: true },
            { id: 2, username: 'manager', name: 'หมอน้อย (ผู้จัดการร้าน)', role: 'manager', pin: '8888', phone: '089-555-1234', active: true },
            { id: 3, username: 'supervisor', name: 'สมบัติ (หัวหน้ากะ)', role: 'supervisor', pin: '5555', phone: '081-234-5678', active: true },
            { id: 4, username: 'cashier1', name: 'มาลี (พนักงานขาย)', role: 'cashier', pin: '0000', phone: '082-345-6789', active: true }
          ];
          for (const e of defaultEmployees) await this.put('employees', e);
        }
      }

      // 3. Customers & Debtors (AR)
      if (this.db.objectStoreNames.contains('customers')) {
        const custs = await this.getAll('customers');
        if (!custs || custs.length === 0) {
          console.log('[DB] สร้างข้อมูลลูกค้าและลูกหนี้การค้าเริ่มต้น 4 รายการ...');
          const defaultCustomers = [
            { id: 1, name: 'ลูกค้าทั่วไป (เงินสด)', phone: '-', address: 'หน้าร้าน', credit_limit: 0, balance_debt: 0, type: 'general' },
            { id: 2, name: 'ร้านลาบป้าพร (เครดิต)', phone: '081-111-2222', address: 'บ้านหนองแวง หมู่ 2', credit_limit: 15000, balance_debt: 0, type: 'wholesale' },
            { id: 3, name: 'เจ๊ณี หมูกระทะ', phone: '086-333-4444', address: 'ตลาดนิคมคำสร้อย', credit_limit: 30000, balance_debt: 0, type: 'wholesale' },
            { id: 4, name: 'สมศรี มะลิวัลย์ (สมาชิก VIP)', phone: '084-555-6666', address: 'ตำบลหนองแวง', credit_limit: 5000, balance_debt: 0, type: 'member' }
          ];
          for (const cu of defaultCustomers) await this.put('customers', cu);
        }
      }

      // 4. Suppliers (AP)
      if (this.db.objectStoreNames.contains('suppliers')) {
        const supps = await this.getAll('suppliers');
        if (!supps || supps.length === 0) {
          console.log('[DB] สร้างข้อมูลเจ้าหนี้การค้าและซัพพลายเออร์เริ่มต้น 3 รายการ...');
          const defaultSuppliers = [
            { id: 1, name: 'ฟาร์มหมูสมบูรณ์ มุกดาหาร', phone: '042-611-222', address: 'อ.เมือง จ.มุกดาหาร', balance_payable: 0 },
            { id: 2, name: 'สหกรณ์ไก่เนื้ออีสาน', phone: '042-633-444', address: 'อ.นิคมคำสร้อย', balance_payable: 0 },
            { id: 3, name: 'ซีพี แอ็กซ์ตร้า (ของชำ)', phone: '042-699-888', address: 'มุกดาหาร', balance_payable: 0 }
          ];
          for (const su of defaultSuppliers) await this.put('suppliers', su);
        }
      }

      // 5. Settings
      if (this.db.objectStoreNames.contains('settings')) {
        const rate = await this.getSetting('exchange_rate_lak', null);
        if (!rate) await this.setSetting('exchange_rate_lak', 169);
        const storeName = await this.getSetting('store_name', null);
        if (!storeName) await this.setSetting('store_name', 'ร้านหมอน้อยฟู้ด');
      }
    } catch (err) {
      console.warn('[DB] ensureDefaultMasterData warning:', err);
    }
  }

  // Generic Helpers
  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getById(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async add(storeName, item) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add(item);
      request.onsuccess = () => {
        const id = request.result;
        // Auto-queue for Cloud Sync if not sync_queue itself
        if (storeName !== 'sync_queue' && window.cloudSyncService) {
          window.cloudSyncService.queueChange(storeName, 'insert', id, item);
        }
        resolve(id);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, item) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(item);
      request.onsuccess = () => {
        const id = request.result;
        if (storeName !== 'sync_queue' && window.cloudSyncService) {
          window.cloudSyncService.queueChange(storeName, 'update', id, item);
        }
        resolve(id);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(id);
      request.onsuccess = () => {
        if (storeName !== 'sync_queue' && window.cloudSyncService) {
          window.cloudSyncService.queueChange(storeName, 'delete', id, { id });
        }
        resolve(true);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db.objectStoreNames.contains(storeName)) {
        resolve(true);
        return;
      }
      const tx = this.db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => {
        if (storeName !== 'sync_queue' && window.cloudSyncService) {
          window.cloudSyncService.queueChange(storeName, 'clear_all', 'all', { store: storeName });
        }
        resolve(true);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getSetting(key, defaultValue = null) {
    const item = await this.getById('settings', key);
    return item ? item.value : defaultValue;
  }

  async setSetting(key, value) {
    return this.put('settings', { key, value });
  }

  // Cloud Sync Queue Methods
  async getPendingSyncItems() {
    return new Promise((resolve) => {
      try {
        if (!this.db.objectStoreNames.contains('sync_queue')) {
          resolve([]);
          return;
        }
        const tx = this.db.transaction(['sync_queue'], 'readonly');
        const store = tx.objectStore('sync_queue');
        const index = store.index('status');
        const request = index.getAll('pending');
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async markSynced(id) {
    const item = await this.getById('sync_queue', id);
    if (item) {
      item.status = 'synced';
      item.synced_at = new Date().toISOString();
      const tx = this.db.transaction(['sync_queue'], 'readwrite');
      const store = tx.objectStore('sync_queue');
      store.put(item);
    }
  }

  // 13-Type Stock Movement Ledger Entry (Immutable - Never direct update stock)
  async recordStockMovement({ productId, moveType, qtyChange, costPrice, refNo, note, userId }) {
    const product = await this.getById('products', productId);
    if (!product) throw new Error('Product not found: ' + productId);

    const currentStock = parseFloat(product.stock || 0);
    const change = parseFloat(qtyChange || 0);
    const newStock = parseFloat((currentStock + change).toFixed(3));

    // 1. Update product balance
    product.stock = newStock;
    await this.put('products', product);

    // 2. Append immutable ledger row
    const ledgerEntry = {
      product_id: productId,
      product_name: product.name,
      move_type: moveType, // IN_PURCHASE, OUT_SALE, ADJ_PLUS, ADJ_MINUS, RETURN_IN, RETURN_OUT, SPOILAGE, etc.
      qty_change: change,
      balance_after: newStock,
      cost_price: costPrice || product.cost || 0,
      ref_no: refNo || '',
      note: note || '',
      user_id: userId || 'system',
      timestamp: new Date().toISOString()
    };

    return this.add('stock_movements', ledgerEntry);
  }

  // Seed default data for หมอน้อยฟู้ด
  async seedIfEmpty() {
    await this.ensureDefaultMasterData();
    const products = await this.getAll('products');
    if (products.length > 0) return; // Already seeded

    console.log('Seeding initial data for ร้านหมอน้อยฟู้ด...');

    // 1. Settings
    const defaultSettings = [
      { key: 'store_name', value: 'ร้านหมอน้อยฟู้ด' },
      { key: 'store_address', value: '107 หมู่ 9 ตำบลหนองแวง อำเภอนิคมคำสร้อย จังหวัดมุกดาหาร' },
      { key: 'store_phone', value: '089-555-1234' },
      { key: 'exchange_rate_lak', value: 169 }, // 1 THB = 169 LAK
      { key: 'scale_baud', value: 9600 },
      { key: 'scale_auto_weigh', value: true },
      { key: 'printer_width', value: 80 },
      { key: 'drawer_kick', value: true },
      { key: 'promptpay_no', value: '0895551234' },
      { key: 'footer_msg', value: 'ขอบคุณที่อุดหนุนหมอน้อยฟู้ด สด สะอาด ปลอดภัย' },
      { key: 'cloud_sync_enabled', value: false }, // Default Local-Only as instructed
      { key: 'firebase_url', value: 'https://kilokamapp-d9128-default-rtdb.asia-southeast1.firebasedatabase.app' },
      { key: 'firebase_api_key', value: 'AIzaSyAd13bqbQHP08lV_q5Yv85BivkImhKJrvE' }
    ];
    for (const s of defaultSettings) {
      await this.put('settings', s);
    }

    // 2. Categories (5 Pakse Categories)
    const categories = [
      { id: 1, name: 'ลูกชิ้น & ไส้กรอก & หมูยอ', icon: '🍢' },
      { id: 2, name: 'ปลาทู', icon: '🐟' },
      { id: 3, name: 'อาหารทะเลสด & แช่แข็ง', icon: '🦐' },
      { id: 4, name: 'หมูสไลด์ชาบู & เครื่องใน', icon: '🥩' },
      { id: 5, name: 'อาหารแปรรูป & เบ็ดเตล็ด', icon: '🥫' }
    ];
    for (const c of categories) {
      await this.put('categories', c);
    }

    // 3. Employees (4-tier RBAC)
    const employees = [
      { id: 1, username: 'admin', name: 'เทพอภัย (ผู้ดูแลระบบ)', role: 'admin', pin: '1234', phone: '089-999-9999', active: true },
      { id: 2, username: 'manager', name: 'หมอน้อย (ผู้จัดการร้าน)', role: 'manager', pin: '8888', phone: '089-555-1234', active: true },
      { id: 3, username: 'supervisor', name: 'สมบัติ (หัวหน้ากะ)', role: 'supervisor', pin: '5555', phone: '081-234-5678', active: true },
      { id: 4, username: 'cashier1', name: 'มาลี (พนักงานขาย)', role: 'cashier', pin: '0000', phone: '082-345-6789', active: true }
    ];
    for (const e of employees) {
      await this.put('employees', e);
    }

    // 4. Customers & Creditors (Zero balance initially)
    const customers = [
      { id: 1, name: 'ลูกค้าทั่วไป', phone: '-', address: 'หน้าร้าน', credit_limit: 0, balance_debt: 0, type: 'general' },
      { id: 2, name: 'ร้านลาบป้าพร (เครดิต)', phone: '081-111-2222', address: 'บ้านหนองแวง หมู่ 2', credit_limit: 15000, balance_debt: 0, type: 'wholesale' },
      { id: 3, name: 'เจ๊ณี หมูกระทะ', phone: '086-333-4444', address: 'ตลาดนิคมคำสร้อย', credit_limit: 30000, balance_debt: 0, type: 'wholesale' },
      { id: 4, name: 'สมศรี มะลิวัลย์ (สมาชิก VIP)', phone: '084-555-6666', address: 'ตำบลหนองแวง', credit_limit: 5000, balance_debt: 0, type: 'member' }
    ];
    for (const cu of customers) {
      await this.put('customers', cu);
    }

    const suppliers = [
      { id: 1, name: 'ฟาร์มหมูสมบูรณ์ มุกดาหาร', phone: '042-611-222', address: 'อ.เมือง จ.มุกดาหาร', balance_payable: 0 },
      { id: 2, name: 'สหกรณ์ไก่เนื้ออีสาน', phone: '042-633-444', address: 'อ.นิคมคำสร้อย', balance_payable: 0 },
      { id: 3, name: 'ซีพี แอ็กซ์ตร้า (ของชำ)', phone: '042-699-888', address: 'มุกดาหาร', balance_payable: 0 }
    ];
    for (const sup of suppliers) {
      await this.put('suppliers', sup);
    }

    // 5. Initial Products (Pakse Real 45 Items with Stock = 0)
    const pakseItems = (typeof window !== 'undefined' && window.PAKSE_PRODUCTS_MASTER) || [];
    for (const p of pakseItems) {
      const cleanProd = Object.assign({}, p, { stock: 0 });
      await this.put('products', cleanProd);
    }

    // 6. Open Shift 1 for cashier
    const initialShift = {
      shift_no: 'SHIFT-20260928-01',
      cashier_id: 1,
      cashier_name: 'เทพอภัย (ผู้ดูแลระบบ)',
      open_time: new Date().toISOString(),
      close_time: null,
      opening_cash_thb: 2000,
      opening_cash_lak: 1000000,
      closing_cash_thb: 0,
      closing_cash_lak: 0,
      actual_cash_thb: 0,
      actual_cash_lak: 0,
      diff_thb: 0,
      diff_lak: 0,
      status: 'open'
    };
    await this.add('cash_sessions', initialShift);

    console.log('IndexedDB Seeding completed successfully!');
  }

  // Clear old products (P001-P017 & TEST-) and install 45 Pakse Products Master with 0 Stock
  async clearOldProductsAndSeedPakse(customProducts = null) {
    if (!this.db) await this.init();
    const items = customProducts || (typeof window !== 'undefined' && window.PAKSE_PRODUCTS_MASTER) || [];
    if (!items || items.length === 0) {
      throw new Error('ไม่พบข้อมูลรายการสินค้าปากเซ 45 รายการ กรุณาตรวจสอบไฟล์ products-pakse-data.js');
    }

    // 1. Clear and re-seed 5 Pakse categories
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(['categories'], 'readwrite');
      const store = tx.objectStore('categories');
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });

    const defaultCats = [
      { id: 1, name: 'ลูกชิ้น & ไส้กรอก & หมูยอ', icon: '🍢' },
      { id: 2, name: 'ปลาทู', icon: '🐟' },
      { id: 3, name: 'อาหารทะเลสด & แช่แข็ง', icon: '🦐' },
      { id: 4, name: 'หมูสไลด์ชาบู & เครื่องใน', icon: '🥩' },
      { id: 5, name: 'อาหารแปรรูป & เบ็ดเตล็ด', icon: '🥫' }
    ];
    for (const c of defaultCats) {
      await this.put('categories', c);
    }

    // 2. Clear old products
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(['products'], 'readwrite');
      const store = tx.objectStore('products');
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });

    // 3. Clear old stock movements (Reset stock transactions to 0)
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(['stock_movements'], 'readwrite');
      const store = tx.objectStore('stock_movements');
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });

    // 4. Reset customers debt & suppliers payable to 0
    try {
      await this.ensureDefaultMasterData();
      const custs = await this.getAll('customers');
      for (const cu of custs) {
        if (cu.balance_debt !== 0) {
          cu.balance_debt = 0;
          await this.put('customers', cu);
        }
      }
      const supps = await this.getAll('suppliers');
      for (const su of supps) {
        if (su.balance_payable !== 0) {
          su.balance_payable = 0;
          await this.put('suppliers', su);
        }
      }
    } catch (e) {
      console.warn('Reset balances notice:', e);
    }

    // 5. Put all 45 real products with stock = 0
    for (const p of items) {
      const cleanProd = Object.assign({}, p, { stock: 0 });
      await this.put('products', cleanProd);
    }

    console.log(`Successfully installed ${items.length} Pakse real products with 0 stock!`);
    return items.length;
  }

  // Dual-Layer Persistence: Auto-backup snapshot to LocalStorage to protect against Android reboot wipe
  async backupToLocalStorage() {
    try {
      const storesToBackup = ['products', 'categories', 'uoms', 'customers', 'suppliers', 'settings', 'cash_sessions'];
      const snapshot = {};
      for (const s of storesToBackup) {
        snapshot[s] = await this.getAll(s);
      }
      snapshot._backupTimestamp = new Date().toISOString();
      snapshot._app = 'POSTRACHANG';
      localStorage.setItem('POSTRACHANG_AUTOBACKUP_STORAGE', JSON.stringify(snapshot));
      console.log('[DB] บันทึก Snapshot สำรองลง LocalStorage สำเร็จ:', snapshot._backupTimestamp);
      return true;
    } catch (err) {
      console.warn('[DB] backupToLocalStorage error:', err);
      return false;
    }
  }

  // Restore snapshot from LocalStorage if IndexedDB was purged by Android
  async restoreFromLocalStorage() {
    try {
      const raw = localStorage.getItem('POSTRACHANG_AUTOBACKUP_STORAGE');
      if (!raw) return false;
      const snapshot = JSON.parse(raw);
      if (!snapshot || snapshot._app !== 'POSTRACHANG') return false;

      console.log('[DB] ตรวจพบข้อมูลสำรอง LocalStorage กำลังกู้คืนฐานข้อมูลที่ถูกรีเซ็ต...');
      for (const storeName of Object.keys(snapshot)) {
        if (storeName.startsWith('_')) continue;
        const items = snapshot[storeName];
        if (Array.isArray(items) && items.length > 0) {
          for (const item of items) {
            await this.put(storeName, item);
          }
        }
      }
      console.log('[DB] กู้คืนฐานข้อมูลจาก LocalStorage สำเร็จสมบูรณ์!');
      return true;
    } catch (err) {
      console.error('[DB] restoreFromLocalStorage failed:', err);
      return false;
    }
  }

  // Export full database to downloadable JSON file
  async exportDatabaseToJson() {
    try {
      const allStores = ['categories', 'uoms', 'products', 'customers', 'suppliers', 'employees', 'sales', 'sale_lines', 'stock_movements', 'cash_sessions', 'debt_payments', 'settings', 'purchases', 'purchase_lines'];
      const exportData = {
        _exportDate: new Date().toISOString(),
        _app: 'POSTRACHANG',
        _version: DB_VERSION,
        data: {}
      };

      for (const store of allStores) {
        exportData.data[store] = await this.getAll(store);
      }

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const datePart = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `POSTRACHANG_BACKUP_${datePart}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (err) {
      console.error('[DB] Export JSON error:', err);
      alert('ส่งออกข้อมูลล้มเหลว: ' + err.message);
      return false;
    }
  }

  // Import full database from JSON string
  async importDatabaseFromJson(jsonString) {
    try {
      const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
      if (!parsed || (!parsed.data && !parsed.products)) {
        throw new Error('รูปแบบไฟล์ JSON ไม่ถูกต้อง');
      }

      const payload = parsed.data || parsed;
      for (const storeName of Object.keys(payload)) {
        if (storeName.startsWith('_')) continue;
        const records = payload[storeName];
        if (Array.isArray(records)) {
          for (const rec of records) {
            await this.put(storeName, rec);
          }
        }
      }

      await this.backupToLocalStorage();
      alert('✅ นำเข้าข้อมูลสำรองสำเร็จสมบูรณ์! กำลังรีเฟรชระบบ...');
      window.location.reload();
      return true;
    } catch (err) {
      console.error('[DB] Import JSON error:', err);
      alert('นำเข้าข้อมูลล้มเหลว: ' + err.message);
      return false;
    }
  }

  // Auto-detect and wipe mock products on load or restore from backup
  async autoMigrateToPakseMasterIfMockDetected() {
    try {
      const prods = await this.getAll('products');
      const hasMock = prods.some(p => p.code === 'P001' || (p.code && p.code.startsWith('P0')) || p.category === 'เนื้อหมูสด');
      
      // If products empty (e.g. after Android reboot), attempt auto-restore from LocalStorage first!
      if (prods.length === 0) {
        const restored = await this.restoreFromLocalStorage();
        if (restored) {
          console.log('[DB] กู้คืนข้อมูลสำเร็จหลังรีบูตระบบ!');
          return;
        }
      }

      if (hasMock || prods.length === 0) {
        console.log('Auto-migrating: Wiping mock products and loading 45 Pakse Real Products (Stock: 0)...');
        await this.clearOldProductsAndSeedPakse();
        await this.backupToLocalStorage();
      }
    } catch (e) {
      console.warn('autoMigrateToPakseMasterIfMockDetected notice:', e);
    }
  }
}

// Global Singleton Instance
window.db = new AppDB();
var db = window.db;
