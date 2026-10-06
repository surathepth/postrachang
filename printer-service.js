/**
 * POSTRACHANG - Printer & Cash Drawer Service (ESC/POS 80mm)
 * Hardware: Xprinter XP-80T (80mm Thermal, USB Type-B) + RJ-11 Cash Drawer (24V)
 * Standard Commands:
 * - Init: ESC @ [0x1B, 0x40]
 * - Cash Drawer Kick: ESC p 0 25 250 [0x1B, 0x70, 0x00, 0x19, 0xFA]
 * - Paper Cut: GS V B 0 [0x1D, 0x56, 0x42, 0x00]
 */

class PrinterService {
  // Whitelist of genuine Thermal POS Receipt Printer Vendor IDs (strictly excluding scale chips like FTDI 0x0403)
  static PRINTER_VENDOR_IDS = [
    0x0416, // Winbond / Xprinter
    0x0483, // STMicroelectronics / Xprinter
    0x1fc9, // NXP / Thermal POS
    0x0fe6, // Generic USB Printer
    0x0471, // Philips POS
    0x28e9, // Gprinter
    0x0dd4, // Custom POS
    0x067b, // Prolific POS
    0x04b8, // Seiko Epson
    0x0519, // Star Micronics
    0x1504, // SNBC
    0x20d1  // ZJiang
  ];

  constructor() {
    this.usbDevice = null;
    this.isConnected = false;
    this.paperWidthMm = 80;
    this.charsPerLine = 48; // Standard 80mm font A
  }

  // Check WebUSB support
  isWebUsbSupported() {
    return 'usb' in navigator;
  }

  // Helper: Verify device is a genuine thermal printer and NEVER the digital scale
  isPrinterDevice(device) {
    if (!device || typeof device.vendorId !== 'number') return false;
    // Explicitly reject digital scale adapters (FTDI FT232R)
    if (device.vendorId === 0x0403) return false;
    // Explicitly reject if bound to scaleService
    if (typeof window !== 'undefined' && window.scaleService && window.scaleService.usbDevice === device) return false;
    // Whitelist check
    return PrinterService.PRINTER_VENDOR_IDS.includes(device.vendorId);
  }

  // Connect WebUSB Xprinter
  async connectUsb() {
    if (!this.isWebUsbSupported()) {
      throw new Error('เบราว์เซอร์นี้ไม่รองรับ WebUSB API (กรุณาใช้งานบน Chrome หรือ Edge)');
    }

    try {
      // Request genuine Thermal POS USB Device with whitelist (strictly excluding digital scale)
      const filters = PrinterService.PRINTER_VENDOR_IDS.map(vid => ({ vendorId: vid }));
      const selected = await navigator.usb.requestDevice({ filters });

      if (!this.isPrinterDevice(selected)) {
        throw new Error('อุปกรณ์ที่เลือกไม่ใช่อุปกรณ์เครื่องพิมพ์ความร้อน (Thermal Printer)');
      }

      this.usbDevice = selected;
      await this.usbDevice.open();
      if (this.usbDevice.configuration === null) {
        await this.usbDevice.selectConfiguration(1);
      }
      await this.usbDevice.claimInterface(0);

      this.isConnected = true;
      return true;
    } catch (err) {
      console.warn('WebUSB connect error or cancelled:', err);
      this.usbDevice = null;
      this.isConnected = false;
      throw err;
    }
  }

  // Auto-connect if genuine thermal printer was already paired previously
  async checkPairedUsb() {
    if (!this.isWebUsbSupported()) {
      this.usbDevice = null;
      this.isConnected = false;
      return false;
    }
    try {
      const devices = await navigator.usb.getDevices();
      if (devices && devices.length > 0) {
        // Strictly filter only genuine thermal printers, NEVER hijack digital scale!
        const printer = devices.find(d => this.isPrinterDevice(d));
        if (printer) {
          this.usbDevice = printer;
          await this.usbDevice.open();
          if (this.usbDevice.configuration === null) {
            await this.usbDevice.selectConfiguration(1);
          }
          await this.usbDevice.claimInterface(0);
          this.isConnected = true;
          return true;
        }
      }
    } catch (err) {
      console.warn('WebUSB auto-reconnect error:', err);
    }
    this.usbDevice = null;
    this.isConnected = false;
    return false;
  }

  // Find OUT endpoint for binary transfer
  findOutEndpoint() {
    if (!this.usbDevice || !this.usbDevice.configuration) return 1;
    try {
      for (const iface of this.usbDevice.configuration.interfaces) {
        for (const alt of iface.alternates) {
          for (const ep of alt.endpoints) {
            if (ep.direction === 'out') {
              return ep.endpointNumber;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error finding out endpoint:', e);
    }
    return 1;
  }

  // Generate ESC/POS Binary for Cash Drawer Kick (RJ-11 Pin 2, 24V)
  getDrawerKickCommand() {
    return new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA]);
  }

  // Generate ESC/POS Binary for Full/Partial Paper Cut
  getPaperCutCommand() {
    return new Uint8Array([0x1D, 0x56, 0x42, 0x00]);
  }

  // Kick Cash Drawer - Universal Hybrid Engine (Android POS Board RJ-11 + Web Serial + WebUSB + Standby)
  async kickDrawer(promptIfDisconnected = false) {
    try {
      // 1. Android POS Native Board Bridge (เมื่อรันบนจอสัมผัส POS Android 14 นิ้ว ผ่านช่อง RJ-11 ประจำเครื่อง)
      if (typeof window !== 'undefined') {
        if (window.Android && typeof window.Android.openCashDrawer === 'function') {
          window.Android.openCashDrawer();
          console.log('[Drawer] เปิดลิ้นชักผ่าน window.Android.openCashDrawer() สำเร็จ');
          return { success: true, method: 'android-native' };
        }
        if (window.Android && typeof window.Android.openDrawer === 'function') {
          window.Android.openDrawer();
          console.log('[Drawer] เปิดลิ้นชักผ่าน window.Android.openDrawer() สำเร็จ');
          return { success: true, method: 'android-native' };
        }
        if (window.posDevice && typeof window.posDevice.openDrawer === 'function') {
          window.posDevice.openDrawer();
          console.log('[Drawer] เปิดลิ้นชักผ่าน window.posDevice.openDrawer() สำเร็จ');
          return { success: true, method: 'pos-device' };
        }
        if (window.posDevice && typeof window.posDevice.openCashDrawer === 'function') {
          window.posDevice.openCashDrawer();
          console.log('[Drawer] เปิดลิ้นชักผ่าน window.posDevice.openCashDrawer() สำเร็จ');
          return { success: true, method: 'pos-device' };
        }
        if (window.Printer && typeof window.Printer.openCashBox === 'function') {
          window.Printer.openCashBox();
          console.log('[Drawer] เปิดลิ้นชักผ่าน window.Printer.openCashBox() สำเร็จ');
          return { success: true, method: 'printer-bridge' };
        }

        // 2. Web Serial API (ถ้าต่อพอร์ต Serial RJ-11 ของบอร์ด POS)
        if (window.drawerSerialPort && window.drawerSerialPort.writable) {
          try {
            const writer = window.drawerSerialPort.writable.getWriter();
            await writer.write(this.getDrawerKickCommand());
            writer.releaseLock();
            console.log('[Drawer] ส่งรหัส ESC/POS [1B 70 00 19 FA] เข้า Serial Port สำเร็จ');
            return { success: true, method: 'serial' };
          } catch (sErr) {
            console.warn('[Drawer] Serial write error:', sErr);
          }
        }
      }

      // 3. WebUSB Direct Transmission (กรณีต่อ WebUSB สำเร็จแล้ว และเป็นเครื่องพิมพ์จริง)
      if (this.isConnected && this.usbDevice && this.isPrinterDevice(this.usbDevice)) {
        try {
          const cmd = this.getDrawerKickCommand();
          const ep = this.findOutEndpoint();
          await this.usbDevice.transferOut(ep, cmd);
          console.log('[Drawer] ส่งรหัส ESC/POS [1B 70 00 19 FA] ตรงเข้า WebUSB สำเร็จ');
          return { success: true, method: 'webusb' };
        } catch (err) {
          console.error('[Drawer] WebUSB transferOut failed:', err);
        }
      }

      // 4. Standby Mode (โหมดเตรียมพร้อมเมื่อใช้งานบน PC หรือเบราว์เซอร์ โดยไม่เด้ง Popup และไม่พิมพ์กระดาษเปล่า)
      console.log('[Drawer] Standby: โหมดพร้อมทำงานอัตโนมัติเมื่อเชื่อมต่อช่อง RJ-11 บนจอ POS Android');
      return {
        success: true,
        method: 'standby',
        message: '🗄️ ลิ้นชักพร้อมทำงานอัตโนมัติเมื่อเสียบช่อง RJ-11 บนจอ POS Android'
      };
    } catch (err) {
      console.error('[Drawer] Kick drawer exception:', err);
      return { success: false, error: err.message };
    }
  }

  // Build Formatted 80mm Thermal Receipt (HTML & Text)
  buildReceiptData(bill, storeInfo = {}) {
    const storeName = storeInfo.name || 'ร้านหมอน้อยฟู้ด';
    const storeAddress = storeInfo.address || '107 ม.9 ต.หนองแวง อ.นิคมคำสร้อย จ.มุกดาหาร';
    const storePhone = storeInfo.phone || '089-555-1234';
    const footerMsg = storeInfo.footer || 'ขอบคุณที่อุดหนุนหมอน้อยฟู้ด สด สะอาด ปลอดภัย';

    const dateStr = bill.timestamp ? new Date(bill.timestamp).toLocaleString('th-TH') : new Date().toLocaleString('th-TH');
    const billNo = bill.bill_no || 'BILL-' + Date.now();
    const cashierName = (bill.cashier_name || 'พนักงานขาย').replace(/\s*\(.*?\)\s*/g, '').trim() || 'พนักงานขาย';
    const customerName = (bill.customer_name || 'ลูกค้าทั่วไป').replace(/\s*\(เงินสด\)\s*/g, '').trim() || 'ลูกค้าทั่วไป';

    return {
      storeName,
      storeAddress,
      storePhone,
      footerMsg,
      dateStr,
      billNo,
      cashierName,
      customerName,
      items: bill.items || [],
      subtotalThb: bill.subtotal_thb || 0,
      discountThb: bill.discount_thb || 0,
      netThb: bill.net_thb || 0,
      netLak: bill.net_lak || 0,
      rateLak: bill.rate_lak || 169,
      payType: bill.pay_type || 'cash',
      payTypeDesc: bill.pay_type_desc || '',
      receivedThb: bill.received_thb || 0,
      receivedLak: bill.received_lak || 0,
      changeThb: bill.change_thb || 0,
      changeLak: bill.change_lak || 0
    };
  }

  // Render Receipt HTML for 80mm preview and print
  renderReceiptHtml(receipt, copyType = '') {
    let rawPayDesc = receipt.payTypeDesc || '';
    let payTypeText = '';
    if (rawPayDesc.includes('เงินสด (บาท') || rawPayDesc === 'เงินสด (Cash)' || rawPayDesc === 'เงินสด (ເງິນສົດ)' || (!rawPayDesc && receipt.payType === 'cash')) {
      payTypeText = 'เงินสด (ເງິນສົດ)';
    } else if (rawPayDesc.includes('เงินสด (กีบ') || rawPayDesc.includes('เงินสดกีบ') || rawPayDesc.includes('ເງິນສົດກີບ') || (!rawPayDesc && receipt.payType === 'cash_lak')) {
      payTypeText = 'เงินสดกีบ (ເງິນສົດກີບ ₭)';
    } else if (rawPayDesc.includes('ผสม') || rawPayDesc.includes('ປະສົມ')) {
      payTypeText = 'เงินสดผสม (ເງິນສົດປະສົມ)';
    } else if (rawPayDesc.includes('QR') || (!rawPayDesc && receipt.payType === 'qr')) {
      payTypeText = 'โอนเงิน QR (ໂອນເງິນ QR)';
    } else if (rawPayDesc.includes('ลูกหนี้') || rawPayDesc.includes('ค้างชำระ') || rawPayDesc.includes('ລູກໜີ້') || (!rawPayDesc && receipt.payType === 'ar')) {
      payTypeText = 'ลูกหนี้การค้า AR (ລູກໜີ້ AR)';
    } else if (rawPayDesc.includes('แต้ม') || rawPayDesc.includes('สมาชิก') || (!rawPayDesc && receipt.payType === 'member')) {
      payTypeText = 'แต้มสะสม / สมาชิก (ສະມາຊິກ)';
    } else {
      payTypeText = rawPayDesc || receipt.payType;
    }

    const isAR = (receipt.payType === 'ar' || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ลูกหนี้')) || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ລູກໜີ້')));
    const titleTh = isAR ? 'ใบส่งสินค้า' : 'ใบเสร็จรับเงิน';
    const titleLa = isAR ? '(ໃບສົ່ງສິນຄ້າ)' : '(ໃບຮັບເງິນ)';

    let itemsRows = '';
    receipt.items.forEach((item, index) => {
      const qtyText = item.is_weight
        ? `${parseFloat(item.qty_or_weight).toFixed(3)} กก.`
        : `${parseInt(item.qty_or_weight)} ${item.uom || 'ชิ้น'}`;

      itemsRows += `
        <div style="margin-bottom: 4px; border-bottom: 1px dashed #000000; padding-bottom: 3px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; font-weight: 500; font-size: 15px; color: #000000;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;">${index + 1}. ${item.product_name}</span>
            <span style="white-space: nowrap; font-weight: 500; font-size: 15px; color: #000000;">${parseFloat(item.total_thb).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 12.5px; color: #000000; margin-top: 1px;">
            <span style="white-space: nowrap;">${qtyText} × ${parseFloat(item.unit_price_thb).toFixed(2)} ฿</span>
            <span style="white-space: nowrap;">${(parseFloat(item.total_thb) * receipt.rateLak).toLocaleString('th-TH', { maximumFractionDigits: 0 })} ₭</span>
          </div>
        </div>
      `;
    });

    return `
      <div id="thermal-receipt-container" style="
        width: 70mm;
        margin: 0 auto;
        padding: 2mm 2.5mm;
        background: #ffffff;
        color: #000000;
        font-family: 'Kanit', 'Noto Sans Lao', 'Saysettha OT', 'Phetsarath OT', Tahoma, sans-serif;
        font-size: 13px;
        line-height: 1.3;
        box-sizing: border-box;
        -webkit-font-smoothing: antialiased;
      ">
        <!-- Store Header -->
        <div style="text-align: center; margin-bottom: 6px;">
          <div style="font-size: 22px; font-weight: 600; letter-spacing: 0; color: #000000;">${receipt.storeName}</div>
          <div style="font-size: 10px; color: #000000; margin-top: 2px; white-space: nowrap; letter-spacing: -0.3px;">${receipt.storeAddress}</div>
          <div style="font-size: 12px; color: #000000;">โทร: ${receipt.storePhone}</div>
          <div style="border-top: 1.5px dashed #000000; margin: 6px 0 5px 0;"></div>
          <div style="font-weight: 600; font-size: 16px; letter-spacing: 0.5px; color: #000000;">${titleTh}</div>
          <div style="font-weight: 500; font-size: 15px; letter-spacing: 0.5px; margin-top: 1px; color: #000000;">${titleLa}</div>
          ${copyType ? `<div style="font-size: 11.5px; font-weight: 600; margin-top: 2px; color: #000000;">[ ${copyType} ]</div>` : ''}
        </div>

        <!-- Meta Info -->
        <div style="font-size: 12px; color: #000000; margin-bottom: 5px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 4px; white-space: nowrap;">
            <span>เลขที่: <strong style="font-weight: 500;">${receipt.billNo}</strong></span>
            <span>${receipt.dateStr}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 4px; margin-top: 2px; white-space: nowrap;">
            <span>แคชเชียร์: ${receipt.cashierName}</span>
            <span>ลูกค้า: ${receipt.customerName}</span>
          </div>
        </div>

        <div style="border-top: 1.5px solid #000000; margin-bottom: 5px;"></div>

        <!-- Column Header -->
        <div style="display: flex; justify-content: space-between; font-weight: 500; font-size: 13.5px; color: #000000; margin-bottom: 4px;">
          <span>รายการสินค้า</span>
          <span>จำนวนเงิน</span>
        </div>
        <div style="border-top: 1px dashed #000000; margin-bottom: 5px;"></div>

        <!-- Line Items -->
        <div style="margin-bottom: 5px;">
          ${itemsRows}
        </div>

        <div style="border-top: 1.5px solid #000000; margin-bottom: 5px;"></div>

        <!-- Totals & Dual Currency -->
        <div style="font-size: 14px; color: #000000;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px; white-space: nowrap;">
            <span>รวมเป็นเงิน (Subtotal):</span>
            <span>${parseFloat(receipt.subtotalThb).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
          </div>
          ${receipt.discountThb > 0 ? `
            <div style="display: flex; justify-content: space-between; color: #000000; margin-bottom: 2px; white-space: nowrap;">
              <span>ส่วนลด (Discount):</span>
              <span>-${parseFloat(receipt.discountThb).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
            </div>
          ` : ''}

          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px; border-top: 1.5px dashed #000000; border-bottom: 1.5px dashed #000000; padding: 4px 0; margin: 5px 0; white-space: nowrap;">
            <span style="font-size: 16px; font-weight: 600;">ยอดชำระสุทธิ (THB):</span>
            <span style="font-size: 19.5px; font-weight: 600;">${parseFloat(receipt.netThb).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin-bottom: 2px; white-space: nowrap;">
            <span style="font-size: 14.5px; font-weight: 500;">ຄິດເປັນເງິນກີບ (LAK ₭):</span>
            <span style="font-size: 17px; font-weight: 600;">${parseFloat(receipt.netLak).toLocaleString('th-TH', { maximumFractionDigits: 0 })} ₭</span>
          </div>
          <div style="font-size: 11.5px; color: #000000; text-align: right; margin-bottom: 4px;">
            (อัตราแลกเปลี่ยน 1 ฿ = ${receipt.rateLak.toLocaleString()} ₭)
          </div>
        </div>

        <div style="border-top: 1px solid #000000; margin-bottom: 5px;"></div>

        <!-- Payment Details -->
        <div style="font-size: 13.5px; color: #000000; margin-bottom: 5px;">
          <div style="display: flex; justify-content: space-between; white-space: nowrap;">
            <span>ช่องทางชำระ (ຊ່ອງທາງຊຳລະ):</span>
            <span><strong>${payTypeText}</strong></span>
          </div>
          ${receipt.receivedLak > 0 ? `
            <div style="display: flex; justify-content: space-between; font-size: 14px; white-space: nowrap;">
              <span>ຮັບເງິນສົດ (ກີບ):</span>
              <span style="font-weight: 500;">${parseFloat(receipt.receivedLak).toLocaleString('th-TH')} ₭</span>
            </div>
          ` : ''}
          ${receipt.receivedThb > 0 ? `
            <div style="display: flex; justify-content: space-between; font-size: 14px; white-space: nowrap;">
              <span>รับเงินสด (บาท):</span>
              <span>${parseFloat(receipt.receivedThb).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12.5px; white-space: nowrap;">
              <span>(ຄິດเป็นເງິນກີບ):</span>
              <span>${(parseFloat(receipt.receivedThb) * receipt.rateLak).toLocaleString('th-TH', { maximumFractionDigits: 0 })} ₭</span>
            </div>
          ` : ''}
          ${(receipt.receivedLak > 0 && receipt.receivedThb === 0) ? `
            <div style="display: flex; justify-content: space-between; font-size: 12.5px; white-space: nowrap;">
              <span>(เทียบเท่าเงินบาท):</span>
              <span>${(parseFloat(receipt.receivedLak) / receipt.rateLak).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
            </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin-top: 3px; border-top: 1px dashed #000000; padding-top: 3px; white-space: nowrap;">
            <span style="font-size: 14.5px; font-weight: 500;">เงินทอน (บาท):</span>
            <span style="font-size: 17.5px; font-weight: 600;">${parseFloat(receipt.changeThb).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font-size: 14px; margin-top: 1px; white-space: nowrap;">
            <span style="font-weight: 500;">ຄິດเป็นເງິນທອນ (ກີບ):</span>
            <span style="font-size: 16px; font-weight: 600;">${parseFloat(receipt.changeLak).toLocaleString('th-TH')} ₭</span>
          </div>
        </div>

        <div style="border-top: 1.5px dashed #000000; margin-bottom: 5px;"></div>

        ${isAR ? `
        <!-- Dual Signature for AR Delivery Note -->
        <div style="margin: 8px 0 6px 0; border: 1px dashed #000000; padding: 6px 4px; font-size: 11px;">
          <div style="display: flex; justify-content: space-between; gap: 8px; text-align: center;">
            <div style="flex: 1;">
              <div style="margin-top: 25px; border-bottom: 1px dotted #000000;"></div>
              <div style="margin-top: 4px; font-weight: 600;">( ........................................ )</div>
              <div style="margin-top: 2px;">ผู้รับสินค้า / ลูกค้า</div>
              <div style="font-size: 9.5px; color: #444;">วันที่ ......./......./...........</div>
            </div>
            <div style="flex: 1;">
              <div style="margin-top: 25px; border-bottom: 1px dotted #000000;"></div>
              <div style="margin-top: 4px; font-weight: 600;">( ........................................ )</div>
              <div style="margin-top: 2px;">ผู้ส่งสินค้า / ร้านค้า</div>
              <div style="font-size: 9.5px; color: #444;">วันที่ ......./......./...........</div>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- Footer -->
        <div style="text-align: center; font-size: 12px; color: #000000;">
          <div>${receipt.footerMsg}</div>
          <div style="margin-top: 3px; font-size: 11px; color: #000000;">ระบบ POSTRACHANG • ร้านหมอน้อยฟู้ด</div>
        </div>
      </div>
    `;
  }

  // Encode String to TIS-620 / CP874 Bytes for Thai Thermal Printers (Xprinter XP-80T)
  encodeTis620(str) {
    if (!str) return new Uint8Array(0);
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code <= 0x7F) {
        bytes.push(code);
      } else if (code >= 0x0E01 && code <= 0x0E5B) {
        // Thai Unicode to TIS-620 / CP874
        bytes.push(code - 0x0E00 + 0xA0);
      } else if (code === 0x000A) { // Newline
        bytes.push(0x0A);
      } else if (code >= 0x0E80 && code <= 0x0EFF) {
        // Transliterate Lao Unicode to nearest Thai phonetic byte
        const laoOffset = code - 0x0E80;
        bytes.push(laoOffset + 0xA0);
      } else {
        bytes.push(0x20); // Fallback space
      }
    }
    return new Uint8Array(bytes);
  }

  // Generate Complete Raw ESC/POS Binary Buffer for 80mm Receipt
  buildEscPosReceipt(receipt, copyTitle = '') {
    const parts = [];
    const pushBytes = (arr) => {
      if (arr instanceof Uint8Array) parts.push(arr);
      else parts.push(new Uint8Array(arr));
    };
    const pushText = (txt) => {
      parts.push(this.encodeTis620(txt));
    };

    // 1. Initialize Printer & Set Code Page CP874 (Thai)
    pushBytes([0x1B, 0x40]); // ESC @ (Init)
    pushBytes([0x1B, 0x74, 254]); // ESC t 254 (CP874 Thai) or 21

    // 2. Header (Centered, Double-Height/Width for Store Name)
    pushBytes([0x1B, 0x61, 1]); // Center align
    pushBytes([0x1D, 0x21, 0x11]); // Double width + double height
    pushText(receipt.storeName + '\n');
    pushBytes([0x1D, 0x21, 0x00]); // Normal text
    pushText(receipt.storeAddress + '\n');
    pushText('Tel: ' + receipt.storePhone + '\n');
    pushText('------------------------------------------------\n');

    const isAR = (receipt.payType === 'ar' || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ลูกหนี้')) || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ລູກໜີ້')));
    const titleTh = isAR ? 'ใบส่งสินค้า (DELIVERY NOTE)' : 'ใบเสร็จรับเงิน (RECEIPT)';
    pushBytes([0x1B, 0x45, 1]); // Bold ON
    pushText(titleTh + '\n');
    if (copyTitle) {
      pushText('[ ' + copyTitle + ' ]\n');
    }
    pushBytes([0x1B, 0x45, 0]); // Bold OFF

    // 3. Meta Info (Left align)
    pushBytes([0x1B, 0x61, 0]); // Left align
    pushText('เลขที่บิล: ' + receipt.billNo + '\n');
    pushText('วันที่: ' + receipt.dateStr + '\n');
    pushText('แคชเชียร์: ' + receipt.cashierName + '   ลูกค้า: ' + receipt.customerName + '\n');
    pushText('================================================\n');
    pushText('รายการสินค้า                  จำนวน      รวมเงิน\n');
    pushText('------------------------------------------------\n');

    // 4. Line Items (Formatted 48 characters for 80mm)
    receipt.items.forEach((item, index) => {
      const idxStr = (index + 1) + '. ';
      const name = item.product_name || '';
      pushText(idxStr + name + '\n');

      const qtyText = item.is_weight
        ? `${parseFloat(item.qty_or_weight).toFixed(3)} กก.`
        : `${parseInt(item.qty_or_weight)} ${item.uom || 'ชิ้น'}`;
      const unitPriceStr = `${qtyText} x ${parseFloat(item.unit_price_thb).toFixed(2)}`;
      const thbTotalStr = `${parseFloat(item.total_thb).toFixed(2)} B`;
      const lakTotalStr = `${Math.round(parseFloat(item.total_thb) * receipt.rateLak).toLocaleString()} K`;

      // Pad spacing to align right
      const leftCol = '   ' + unitPriceStr;
      const rightCol = thbTotalStr + ' (' + lakTotalStr + ')';
      const spacesNeeded = Math.max(1, 48 - leftCol.length - rightCol.length);
      pushText(leftCol + ' '.repeat(spacesNeeded) + rightCol + '\n');
    });

    pushText('------------------------------------------------\n');

    // 5. Totals & Dual Currency
    const formatLine = (label, valStr) => {
      const spaces = Math.max(1, 48 - label.length - valStr.length);
      return label + ' '.repeat(spaces) + valStr + '\n';
    };

    pushText(formatLine('รวมเป็นเงิน (Subtotal):', parseFloat(receipt.subtotalThb).toFixed(2) + ' B'));
    if (receipt.discountThb > 0) {
      pushText(formatLine('ส่วนลด (Discount):', '-' + parseFloat(receipt.discountThb).toFixed(2) + ' B'));
    }

    pushBytes([0x1B, 0x45, 1]); // Bold
    pushText('------------------------------------------------\n');
    pushBytes([0x1D, 0x21, 0x01]); // Double height
    pushText(formatLine('ยอดชำระสุทธิ (THB):', parseFloat(receipt.netThb).toFixed(2) + ' B'));
    pushBytes([0x1D, 0x21, 0x00]); // Normal
    pushText(formatLine('คิดเป็นเงินกีบ (LAK):', Math.round(receipt.netLak).toLocaleString() + ' K'));
    pushBytes([0x1B, 0x45, 0]); // Bold OFF
    pushText('   (อัตราแลกเปลี่ยน 1 B = ' + receipt.rateLak + ' K)\n');
    pushText('------------------------------------------------\n');

    // 6. Payment & Change
    pushText(formatLine('ช่องทางชำระ:', receipt.payTypeDesc || receipt.payType));
    if (receipt.receivedThb > 0) {
      pushText(formatLine('รับเงินสด (บาท):', parseFloat(receipt.receivedThb).toFixed(2) + ' B'));
    }
    if (receipt.receivedLak > 0) {
      pushText(formatLine('รับเงินสด (กีบ):', Math.round(receipt.receivedLak).toLocaleString() + ' K'));
    }
    pushText(formatLine('เงินทอน (บาท):', parseFloat(receipt.changeThb).toFixed(2) + ' B'));
    pushText(formatLine('เงินทอน (กีบ):', Math.round(receipt.changeLak).toLocaleString() + ' K'));
    pushText('================================================\n');

    // 7. Dual Signature for Delivery Note / AR
    if (isAR) {
      pushText('\n');
      pushText('  ผู้รับสินค้า: ....................  ผู้ส่งสินค้า: ....................\n');
      pushText('  (ลงชื่อลูกค้า/ผู้รับ)               (ลงชื่อผู้ส่ง/ร้านค้า)\n\n');
    }

    // 8. Footer (Centered)
    pushBytes([0x1B, 0x61, 1]); // Center
    pushText(receipt.footerMsg + '\n');
    pushText('ระบบ POSTRACHANG • ร้านหมอน้อยฟู้ด\n\n\n');

    // 9. Kick Cash Drawer & Paper Cut (Instant 1-second finish)
    if (!isAR) {
      pushBytes([0x1B, 0x70, 0x00, 0x19, 0xFA]); // ESC p 0 25 250 (Kick RJ-11 Drawer)
    }
    pushBytes([0x1D, 0x56, 0x42, 0x00]); // GS V 66 0 (Paper Cut)

    // Merge all byte parts into one contiguous Uint8Array
    const totalLength = parts.reduce((acc, p) => acc + p.length, 0);
    const fullBuffer = new Uint8Array(totalLength);
    let offset = 0;
    parts.forEach(p => {
      fullBuffer.set(p, offset);
      offset += p.length;
    });

    return fullBuffer;
  }

  // Render clean 80mm monochrome receipt onto HTML5 Canvas (576px width)
  renderReceiptToCanvas(receipt, copyType = '') {
    const width = 576; // 80mm thermal print head width (203 DPI = 72mm printable width)
    let rawPayDesc = receipt.payTypeDesc || '';
    let payTypeText = '';
    if (rawPayDesc.includes('เงินสด (บาท') || rawPayDesc === 'เงินสด (Cash)' || rawPayDesc === 'เงินสด (ເງິນສົດ)' || (!rawPayDesc && receipt.payType === 'cash')) {
      payTypeText = 'เงินสด (ເງິນສົດ)';
    } else if (rawPayDesc.includes('เงินสด (กีบ') || rawPayDesc.includes('เงินสดกีบ') || rawPayDesc.includes('ເງິນສົດກີບ') || (!rawPayDesc && receipt.payType === 'cash_lak')) {
      payTypeText = 'เงินสดกีบ (ເງິນສົດກີບ ₭)';
    } else if (rawPayDesc.includes('ผสม') || rawPayDesc.includes('ປະສົມ')) {
      payTypeText = 'เงินสดผสม (ເງິນສົດປະສົມ)';
    } else if (rawPayDesc.includes('QR') || (!rawPayDesc && receipt.payType === 'qr')) {
      payTypeText = 'โอนเงิน QR (ໂອນເງິນ QR)';
    } else if (rawPayDesc.includes('ลูกหนี้') || rawPayDesc.includes('ค้างชำระ') || rawPayDesc.includes('ລູກໜີ້') || (!rawPayDesc && receipt.payType === 'ar')) {
      payTypeText = 'ลูกหนี้การค้า AR (ລູກໜີ້ AR)';
    } else if (rawPayDesc.includes('แต้ม') || rawPayDesc.includes('สมาชิก') || (!rawPayDesc && receipt.payType === 'member')) {
      payTypeText = 'แต้มสะสม / สมาชิก (ສະມາຊິກ)';
    } else {
      payTypeText = rawPayDesc || receipt.payType;
    }

    const isAR = (receipt.payType === 'ar' || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ลูกหนี้')) || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ລູກໜີ້')));
    const titleTh = isAR ? 'ใบส่งสินค้า' : 'ใบเสร็จรับเงิน';
    const titleLa = isAR ? '(ໃບສົ່ງສິນຄ້າ)' : '(ໃບຮັບເງິນ)';

    // Estimate initial height (Generous buffer for extra large 80mm fonts)
    let estHeight = 750 + (receipt.items.length * 105) + 480;
    if (isAR) estHeight += 200;
    if (copyType) estHeight += 50;
    if (receipt.discountThb > 0) estHeight += 45;
    if (receipt.receivedLak > 0) estHeight += 45;
    if (receipt.receivedThb > 0) estHeight += 60;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = estHeight;
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, estHeight);
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';

    const padL = 4;
    const padR = width - 4;
    const center = width / 2;
    let y = 42;

    const drawDashedLine = (currY) => {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, currY);
      ctx.lineTo(padR, currY);
      ctx.stroke();
      ctx.restore();
    };

    const drawSolidLine = (currY, thickness = 1.5) => {
      ctx.save();
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.moveTo(padL, currY);
      ctx.lineTo(padR, currY);
      ctx.stroke();
      ctx.restore();
    };

    // 1. Store Header & Title (Extra Large & High-Contrast Bold for 80mm)
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText(receipt.storeName || 'ร้านหมอน้อยฟู้ด', center, y);
    y += 38;

    ctx.font = 'bold 22px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText(receipt.storeAddress || '', center, y);
    y += 28;

    ctx.fillText('โทร: ' + (receipt.storePhone || ''), center, y);
    y += 24;

    drawDashedLine(y);
    y += 34;

    ctx.font = 'bold 38px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText(titleTh, center, y);
    y += 34;

    ctx.font = 'bold 30px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText(titleLa, center, y);
    y += 28;

    if (copyType) {
      ctx.font = 'bold 24px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
      ctx.fillText('[ ' + copyType + ' ]', center, y);
      y += 28;
    }

    // 2. Meta Info (Bold & High Legibility)
    y += 6;
    drawSolidLine(y);
    y += 30;

    ctx.font = 'bold 24px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('เลขที่: ' + (receipt.billNo || ''), padL, y);
    ctx.textAlign = 'right';
    ctx.fillText(receipt.dateStr || '', padR, y);
    y += 30;

    ctx.textAlign = 'left';
    ctx.fillText('แคชเชียร์: ' + (receipt.cashierName || ''), padL, y);
    ctx.textAlign = 'right';
    ctx.fillText('ลูกค้า: ' + (receipt.customerName || ''), padR, y);
    y += 22;

    drawSolidLine(y);
    y += 30;

    // 3. Column Header (Wide & Clear)
    ctx.font = 'bold 28px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('รายการสินค้า', padL, y);
    ctx.textAlign = 'right';
    ctx.fillText('จำนวนเงิน', padR, y);
    y += 18;

    drawDashedLine(y);
    y += 30;

    // 4. Line Items (Extra Large 28px bold product names, 24px bold calculation)
    receipt.items.forEach((item, index) => {
      const qtyText = item.is_weight
        ? `${parseFloat(item.qty_or_weight).toFixed(3)} กก.`
        : `${parseInt(item.qty_or_weight)} ${item.uom || 'ชิ้น'}`;
      const itemTotalThb = parseFloat(item.total_thb || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿';
      const itemTotalLak = (parseFloat(item.total_thb || 0) * receipt.rateLak).toLocaleString('th-TH', { maximumFractionDigits: 0 }) + ' ₭';
      const itemSub = `${qtyText} × ${parseFloat(item.unit_price_thb || 0).toFixed(2)} ฿`;

      // Item Name + Total THB
      ctx.font = 'bold 28px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
      ctx.textAlign = 'left';
      const itemName = `${index + 1}. ${item.product_name}`;
      ctx.fillText(itemName, padL, y);
      ctx.textAlign = 'right';
      ctx.fillText(itemTotalThb, padR, y);
      y += 32;

      // Qty x UnitPrice + Total LAK
      ctx.font = 'bold 24px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(itemSub, padL + 10, y);
      ctx.textAlign = 'right';
      ctx.fillText(itemTotalLak, padR, y);
      y += 16;

      drawDashedLine(y);
      y += 28;
    });

    // 5. Totals
    drawSolidLine(y);
    y += 30;

    ctx.font = 'bold 28px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('รวมเป็นเงิน (Subtotal):', padL, y);
    ctx.textAlign = 'right';
    ctx.fillText(parseFloat(receipt.subtotalThb || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿', padR, y);
    y += 32;

    if (receipt.discountThb > 0) {
      ctx.textAlign = 'left';
      ctx.fillText('ส่วนลด (Discount):', padL, y);
      ctx.textAlign = 'right';
      ctx.fillText('-' + parseFloat(receipt.discountThb).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿', padR, y);
      y += 32;
    }

    drawDashedLine(y);
    y += 34;

    // Net THB (Extra Large 44px Bold for 80mm)
    ctx.font = 'bold 28px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ยอดชำระสุทธิ (THB):', padL, y);
    ctx.font = 'bold 44px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(parseFloat(receipt.netThb || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿', padR, y);
    y += 44;

    // Net LAK
    ctx.font = 'bold 26px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ຄິດເປັນເງິນກີບ (LAK ₭):', padL, y);
    ctx.font = 'bold 36px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(parseFloat(receipt.netLak || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 }) + ' ₭', padR, y);
    y += 28;

    ctx.font = 'bold 20px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`(อัตราแลกเปลี่ยน 1 ฿ = ${receipt.rateLak.toLocaleString()} ₭)`, padR, y);
    y += 20;

    drawSolidLine(y);
    y += 30;

    // 6. Payment Details
    ctx.font = 'bold 26px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ช่องทางชำระ (ຊ່ອງທາງຊຳລະ):', padL, y);
    ctx.textAlign = 'right';
    ctx.fillText(payTypeText, padR, y);
    y += 30;

    if (receipt.receivedLak > 0) {
      ctx.textAlign = 'left';
      ctx.fillText('ຮັບເງິນສົດ (ກີບ):', padL, y);
      ctx.textAlign = 'right';
      ctx.fillText(parseFloat(receipt.receivedLak).toLocaleString('th-TH') + ' ₭', padR, y);
      y += 28;
    }

    if (receipt.receivedThb > 0) {
      ctx.textAlign = 'left';
      ctx.fillText('รับเงินสด (บาท):', padL, y);
      ctx.textAlign = 'right';
      ctx.fillText(parseFloat(receipt.receivedThb).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿', padR, y);
      y += 28;
    }

    drawDashedLine(y);
    y += 32;

    // Change THB & LAK
    ctx.font = 'bold 30px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('เงินทอน (บาท):', padL, y);
    ctx.font = 'bold 36px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(parseFloat(receipt.changeThb || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿', padR, y);
    y += 36;

    ctx.font = 'bold 26px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ຄິດเป็นເງິນທອນ (ກີບ):', padL, y);
    ctx.font = 'bold 30px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(parseFloat(receipt.changeLak || 0).toLocaleString('th-TH') + ' ₭', padR, y);
    y += 24;

    drawSolidLine(y);
    y += 30;

    // 7. AR Signatures
    if (isAR) {
      ctx.font = 'bold 18px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
      ctx.textAlign = 'center';
      
      const sigL = width * 0.28;
      const sigR = width * 0.72;
      
      y += 40;
      drawDashedLine(y - 12);
      
      ctx.fillText('( ........................................ )', sigL, y);
      ctx.fillText('( ........................................ )', sigR, y);
      y += 24;

      ctx.font = 'bold 18px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
      ctx.fillText('ผู้รับสินค้า / ลูกค้า', sigL, y);
      ctx.fillText('ผู้ส่งสินค้า / ร้านค้า', sigR, y);
      y += 22;

      ctx.font = 'bold 16px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
      ctx.fillText('วันที่ ......./......./...........', sigL, y);
      ctx.fillText('วันที่ ......./......./...........', sigR, y);
      y += 20;

      drawSolidLine(y);
      y += 28;
    }

    // 8. Footer
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText(receipt.footerMsg || '', center, y);
    y += 28;

    ctx.font = 'bold 20px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText('ระบบ POSTRACHANG • ร้านหมอน้อยฟู้ด', center, y);
    y += 30;

    // Crop to exact height
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = width;
    finalCanvas.height = Math.ceil(y);
    const fctx = finalCanvas.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    fctx.drawImage(canvas, 0, 0);

    return finalCanvas;
  }

  // Render Full Receipt Canvas (handles single receipt or dual AR receipts with tear line)
  renderReceiptFullCanvas(receipt) {
    const isAR = (receipt.payType === 'ar' || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ลูกหนี้')) || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ລູກໜີ້')));
    if (!isAR) {
      return this.renderReceiptToCanvas(receipt);
    }

    // AR Dual Receipt: Customer Copy + Shop Copy
    const copy1Canvas = this.renderReceiptToCanvas(receipt, 'สำหรับลูกค้า / ต้นฉบับ (ສຳລັບລູກຄ້າ)');
    const copy2Canvas = this.renderReceiptToCanvas(receipt, 'สำหรับร้านค้า / สำเนาบัญชี (ສຳລັບຮ້ານຄ້າ)');
    const tearHeight = 60;
    const totalHeight = copy1Canvas.height + tearHeight + copy2Canvas.height;

    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = 576;
    combinedCanvas.height = totalHeight;
    const ctx = combinedCanvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, combinedCanvas.width, totalHeight);

    // Draw Copy 1
    ctx.drawImage(copy1Canvas, 0, 0);

    // Draw Tear Line in middle
    const tearY = copy1Canvas.height + 30;
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, tearY);
    ctx.lineTo(556, tearY);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "Kanit", "Noto Sans Lao", Tahoma, sans-serif';
    ctx.fillText('✂️ ฉีกตามรอยปรุ (Tear Here) ✂️', 288, tearY - 8);
    ctx.restore();

    // Draw Copy 2
    ctx.drawImage(copy2Canvas, 0, copy1Canvas.height + tearHeight);

    return combinedCanvas;
  }

  // Render clean 80mm monochrome debt receipt onto HTML5 Canvas
  renderDebtReceiptToCanvas(paymentData, storeInfo = {}) {
    const width = 576;
    const storeName = storeInfo.name || 'ร้านหมอน้อยฟู้ด';
    const storeAddress = storeInfo.address || '107 ม.9 ต.หนองแวง อ.นิคมคำสร้อย จ.มุกดาหาร';
    const storePhone = storeInfo.phone || '089-555-1234';
    const footerMsg = storeInfo.footer || 'ขอบคุณที่ชำระหนี้ตรงเวลา ขอขอบพระคุณเป็นอย่างยิ่ง';

    const dateStr = paymentData.timestamp ? new Date(paymentData.timestamp).toLocaleString('th-TH') : new Date().toLocaleString('th-TH');
    const billRef = paymentData.bill_no || '-';
    const customerName = paymentData.customer_name || 'ลูกค้าทั่วไป';
    const cashierName = paymentData.user_id || paymentData.cashier_name || 'ผู้รับเงิน';
    const rateLak = paymentData.rate_lak || 169;
    const amountThb = parseFloat(paymentData.amount_thb || 0);
    const amountLak = parseFloat(paymentData.amount_lak || (Math.round((amountThb * rateLak) / 500) * 500));
    const prevDebtThb = parseFloat(paymentData.previous_debt || 0);
    const remainDebtThb = parseFloat(paymentData.remaining_debt || 0);
    const payTypeDesc = paymentData.pay_type_desc || (paymentData.pay_type === 'qr' ? 'โอนเงิน QR' : 'เงินสด (Cash)');

    const estHeight = 850;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = estHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, estHeight);
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';

    const padL = 4;
    const padR = width - 4;
    const center = width / 2;
    let y = 42;

    const drawDashedLine = (currY) => {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, currY);
      ctx.lineTo(padR, currY);
      ctx.stroke();
      ctx.restore();
    };

    const drawSolidLine = (currY, thickness = 1.5) => {
      ctx.save();
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.moveTo(padL, currY);
      ctx.lineTo(padR, currY);
      ctx.stroke();
      ctx.restore();
    };

    // Header (Large & Bold for 80mm)
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText(storeName, center, y);
    y += 38;

    ctx.font = 'bold 22px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText(storeAddress, center, y);
    y += 28;

    ctx.fillText('โทร: ' + storePhone, center, y);
    y += 24;

    drawDashedLine(y);
    y += 34;

    ctx.font = 'bold 38px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText('ใบเสร็จรับเงิน (รับชำระหนี้)', center, y);
    y += 34;

    ctx.font = 'bold 30px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText('(ໃບຮັບເງິນ - ຊຳລະໜີ້)', center, y);
    y += 28;

    ctx.font = 'bold 24px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText('[ สำหรับลูกค้า / ต้นฉบับ ]', center, y);
    y += 28;

    drawSolidLine(y);
    y += 30;

    // Meta Info
    ctx.font = 'bold 24px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('บิลอ้างอิง: ' + billRef, padL, y);
    ctx.textAlign = 'right';
    ctx.fillText(dateStr, padR, y);
    y += 30;

    ctx.textAlign = 'left';
    ctx.fillText('ลูกค้า: ' + customerName, padL, y);
    ctx.textAlign = 'right';
    ctx.fillText('ผู้รับเงิน: ' + cashierName, padR, y);
    y += 22;

    drawSolidLine(y);
    y += 30;

    // Debt details
    const prevDebtLak = Math.round((prevDebtThb * rateLak) / 500) * 500;
    const remainDebtLak = Math.round((remainDebtThb * rateLak) / 500) * 500;

    ctx.font = 'bold 26px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ยอดหนี้เดิมในบิลนี้:', padL, y);
    ctx.textAlign = 'right';
    ctx.fillText('฿' + prevDebtThb.toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' (' + prevDebtLak.toLocaleString() + ' ₭)', padR, y);
    y += 32;

    drawDashedLine(y);
    y += 34;

    ctx.font = 'bold 28px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ยอดชำระครั้งนี้ (THB):', padL, y);
    ctx.font = 'bold 44px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('฿' + amountThb.toLocaleString('th-TH', { minimumFractionDigits: 2 }), padR, y);
    y += 44;

    ctx.font = 'bold 26px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('คิดเป็นเงินกีบ (LAK ₭):', padL, y);
    ctx.font = 'bold 36px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(amountLak.toLocaleString('th-TH', { maximumFractionDigits: 0 }) + ' ₭', padR, y);
    y += 30;

    drawDashedLine(y);
    y += 32;

    ctx.font = 'bold 26px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ยอดหนี้คงเหลือสุทธิ:', padL, y);
    ctx.textAlign = 'right';
    ctx.fillText('฿' + remainDebtThb.toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' (' + remainDebtLak.toLocaleString() + ' ₭)', padR, y);
    y += 32;

    ctx.font = 'bold 26px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ช่องทางชำระ:', padL, y);
    ctx.textAlign = 'right';
    ctx.fillText(payTypeDesc, padR, y);
    y += 30;

    if (paymentData.note) {
      ctx.textAlign = 'left';
      ctx.font = 'bold 22px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
      ctx.fillText('หมายเหตุ: ' + paymentData.note, padL, y);
      y += 28;
    }

    drawSolidLine(y);
    y += 30;

    // Signatures
    ctx.font = 'bold 20px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.textAlign = 'center';
    const sigL = width * 0.28;
    const sigR = width * 0.72;
    y += 42;
    drawDashedLine(y - 12);

    ctx.fillText('( ........................................ )', sigL, y);
    ctx.fillText('( ........................................ )', sigR, y);
    y += 26;

    ctx.font = 'bold 20px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText('ผู้ชำระเงิน / ลูกหนี้', sigL, y);
    ctx.fillText('ผู้รับเงิน / ร้านค้า', sigR, y);
    y += 24;

    drawSolidLine(y);
    y += 30;

    // Footer
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText(footerMsg, center, y);
    y += 28;

    ctx.font = 'bold 20px "Sarabun", "Kanit", "Noto Sans Thai", "Noto Sans Lao", sans-serif';
    ctx.fillText('ระบบ POSTRACHANG • ร้านหมอน้อยฟู้ด', center, y);
    y += 30;

    // Crop to exact height
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = width;
    finalCanvas.height = Math.ceil(y);
    const fctx = finalCanvas.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    fctx.drawImage(canvas, 0, 0);

    return finalCanvas;
  }

  // Convert HTML5 Canvas to Standard ESC/POS Raster Bit Image (GS v 0) with clean single cut
  canvasToEscPosRaster(canvas, options = {}) {
    const withCut = options.cut !== false;
    const withInit = options.init !== false;
    const feedLines = typeof options.feedLines === 'number' ? options.feedLines : 5;

    const width = canvas.width; // 576 dots
    const height = canvas.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, width, height).data;

    const widthBytes = Math.ceil(width / 8); // 72 bytes
    const xL = widthBytes & 0xFF;
    const xH = (widthBytes >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;

    const header = [];
    if (withInit) {
      header.push(0x1B, 0x40); // ESC @ (Init/Reset buffer - critical to prevent Chinese text)
    }
    header.push(
      0x1D, 0x76, 0x30, 0x00, // GS v 0 0 (Raster bit image)
      xL, xH,
      yL, yH
    );

    const totalBytes = header.length + (widthBytes * height) + 16;
    const buffer = new Uint8Array(totalBytes);
    buffer.set(header, 0);

    let offset = header.length;
    for (let y = 0; y < height; y++) {
      for (let xb = 0; xb < widthBytes; xb++) {
        let byteVal = 0;
        for (let b = 0; b < 8; b++) {
          const x = (xb * 8) + b;
          if (x < width) {
            const idx = (y * width + x) * 4;
            const r = imgData[idx];
            const g = imgData[idx + 1];
            const bVal = imgData[idx + 2];
            const a = imgData[idx + 3];
            const lum = 0.299 * r + 0.587 * g + 0.114 * bVal;
            if (a > 128 && lum < 140) {
              byteVal |= (0x80 >> b);
            }
          }
        }
        buffer[offset++] = byteVal;
      }
    }

    if (withCut) {
      // Feed lines so receipt clears the physical cutter blade (~12-15mm)
      if (feedLines > 0) {
        buffer[offset++] = 0x1B; // ESC d n
        buffer[offset++] = 0x64;
        buffer[offset++] = feedLines & 0xFF;
      }

      // Single Standard ESC/POS Partial Cut (GS V 66 0)
      buffer[offset++] = 0x1D;
      buffer[offset++] = 0x56;
      buffer[offset++] = 0x42;
      buffer[offset++] = 0x00;
    }

    return buffer.subarray(0, offset);
  }

  // Fast & Safe Uint8Array to Base64 (Chunked to prevent stack overflow on large buffers)
  uint8ToBase64(bytes) {
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  // Render Short Test Slip Canvas (576 dots / 80mm ~ 4.5cm) to verify Thai/Lao fonts and cutting
  renderTestCanvas() {
    const width = 576;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');

    // Background White
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, 420);

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';

    let y = 36;
    ctx.font = 'bold 36px "Sarabun", "Kanit", "Noto Sans Thai", sans-serif';
    ctx.fillText('ร้านหมอน้อยฟู้ด (หมอน้อย)', width / 2, y);

    y += 34;
    ctx.font = 'bold 22px "Sarabun", "Kanit", "Noto Sans Thai", sans-serif';
    ctx.fillText('🖨️ ทดสอบไดรเวอร์เครื่องพิมพ์ภาษาไทย 100%', width / 2, y);

    y += 20;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(width - 4, y);
    ctx.stroke();
    ctx.setLineDash([]);

    y += 30;
    ctx.font = 'bold 20px "Sarabun", "Kanit", "Noto Sans Thai", sans-serif';
    ctx.fillText('แบบทดสอบสระและวรรณยุกต์ภาษาไทย:', width / 2, y);

    y += 28;
    ctx.font = '18px "Sarabun", "Kanit", "Noto Sans Thai", sans-serif';
    ctx.fillText('ก ข ค ง จ ฉ ช ซ ฌ ญ ฎ ฏ ฐ ฑ ฒ ณ ด ต ถ ท ธ น', width / 2, y);

    y += 26;
    ctx.fillText('บ ป ผ ฝ พ ฟ ภ ม ย ร ล ว ศ ษ ส ห ฬ อ ฮ', width / 2, y);

    y += 26;
    ctx.fillText('สระ-วรรณยุกต์: กะ กิ กี กึ กื กุ กู เก แก โก ใก ไก ก็ ก่ ก้ ก๊ ก๋ ก์', width / 2, y);

    y += 30;
    ctx.font = '18px "Noto Sans Lao", "Sarabun", "Kanit", sans-serif';
    ctx.fillText('ທົດສອບພາສາລາວ: ສະບາຍດີ ຍິນດີຕ້ອນຮັບ 100%', width / 2, y);

    y += 26;
    ctx.fillText('ອັດຕາແລກປ່ຽນ: 1 ບາດ (฿) = 169 ກີບ (₭)', width / 2, y);

    y += 22;
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(width - 4, y);
    ctx.stroke();

    y += 28;
    ctx.font = 'bold 20px "Sarabun", "Kanit", "Noto Sans Thai", sans-serif';
    ctx.fillText('✅ การพิมพ์ภาษาไทยและตัดกระดาษ: สมบูรณ์แบบ 100%', width / 2, y);

    y += 26;
    const now = new Date();
    const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    ctx.font = '16px "Sarabun", "Kanit", "Noto Sans Thai", sans-serif';
    ctx.fillText('วันที่ทดสอบ: ' + dateStr, width / 2, y);

    y += 22;

    // Crop to exact height
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = width;
    finalCanvas.height = Math.ceil(y);
    const fctx = finalCanvas.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    fctx.drawImage(canvas, 0, 0);

    return finalCanvas;
  }

  // Dispatch RawBT Intent safely via Hidden iFrame to prevent Chrome from exiting FullScreen
  dispatchRawBt(b64) {
    try {
      let iframe = document.getElementById('rawbt-intent-frame');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'rawbt-intent-frame';
        iframe.style.position = 'fixed';
        iframe.style.top = '-9999px';
        iframe.style.left = '-9999px';
        iframe.style.width = '1px';
        iframe.style.height = '1px';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        document.body.appendChild(iframe);
      }
      iframe.src = 'rawbt:base64,' + b64;
    } catch (e) {
      const a = document.createElement('a');
      a.href = 'rawbt:base64,' + b64;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  // Print Test Slip - Instant ESC/POS Raster (Direct WebUSB or RawBT on Android)
  async printTestSlip() {
    try {
      const isAndroid = typeof window !== 'undefined' && /Android/i.test(navigator.userAgent);
      const canvas = this.renderTestCanvas();
      const rasterBytes = this.canvasToEscPosRaster(canvas);

      // 1. WebUSB connected (เครื่องพิมพ์ความร้อนจริงเท่านั้น)
      if (this.isConnected && this.usbDevice && this.isPrinterDevice(this.usbDevice)) {
        const ep = this.findOutEndpoint();
        await this.usbDevice.transferOut(ep, rasterBytes);
        console.log('[Printer] พิมพ์ทดสอบภาษาไทยผ่าน WebUSB สำเร็จ');
        if (typeof showToast === 'function') showToast('✅ พิมพ์ทดสอบภาษาไทยผ่าน WebUSB สำเร็จ', 'success');
        return { success: true, method: 'webusb-raster' };
      }

      // 2. Android POS via RawBT (rawbt:base64,)
      if (isAndroid) {
        const b64 = this.uint8ToBase64(rasterBytes);
        this.dispatchRawBt(b64);
        console.log('[Printer] ส่งพิมพ์ทดสอบภาษาไทยผ่าน RawBT (rawbt:base64,) สำเร็จ');
        if (typeof showToast === 'function') showToast('✅ ส่งพิมพ์ทดสอบภาษาไทยผ่าน RawBT สำเร็จ', 'success');
        return { success: true, method: 'rawbt-base64' };
      }

      // 3. Desktop PC Fallback: Clean iframe
      const dataUrl = canvas.toDataURL('image/png');
      const win = window.open('', '_blank', 'width=350,height=500');
      if (win) {
        win.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>ทดสอบพิมพ์</title>
            <style>
              @page { size: 80mm auto; margin: 0; }
              body { margin: 0; padding: 0; display: flex; justify-content: center; }
              img { width: 100%; max-width: 80mm; display: block; }
            </style>
          </head>
          <body>
            <img src="${dataUrl}">
            <script>
              window.onload = function() {
                window.focus();
                window.print();
                setTimeout(function() { window.close(); }, 1000);
              };
            <\/script>
          </body>
          </html>
        `);
        win.document.close();
        return { success: true, method: 'browser-preview' };
      }
    } catch (err) {
      console.error('[Printer] พิมพ์ทดสอบล้มเหลว:', err);
      if (typeof showToast === 'function') showToast('❌ พิมพ์ทดสอบล้มเหลว: ' + err.message, 'error');
    }
  }

  // Direct USB / RawBT Binary Print Dispatcher (Instant < 1s)
  async printReceiptRaw(bill, storeInfo = {}) {
    const isAndroid = typeof window !== 'undefined' && /Android/i.test(navigator.userAgent);
    const receipt = this.buildReceiptData(bill, storeInfo);
    const isAR = (receipt.payType === 'ar' || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ลูกหนี้')) || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ລູກໜີ້')));

    // If AR: Handle sequential dual print to trigger physical cut between Copy 1 and Copy 2
    if (isAR) {
      const copy1Canvas = this.renderReceiptToCanvas(receipt, 'สำหรับลูกค้า / ต้นฉบับ (ສຳລັບລູກຄ້າ)');
      const copy2Canvas = this.renderReceiptToCanvas(receipt, 'สำหรับร้านค้า / สำเนาบัญชี (ສຳລັບຮ້ານຄ້າ)');
      // Copy 1: Inits printer, feeds 5 lines, and cuts cleanly
      const raster1 = this.canvasToEscPosRaster(copy1Canvas, { init: true, feedLines: 5, cut: true });
      // Copy 2: Direct graphics (no ESC @ to avoid mid-job reset), feeds 5 lines, and cuts cleanly
      const raster2 = this.canvasToEscPosRaster(copy2Canvas, { init: false, feedLines: 5, cut: true });

      // Combine both copies into a single contiguous binary stream (One RawBT Intent = 100% reliable)
      const combinedBuffer = new Uint8Array(raster1.length + raster2.length);
      combinedBuffer.set(raster1, 0);
      combinedBuffer.set(raster2, raster1.length);

      // 1. Direct WebUSB Transmission (Only for genuine thermal printer)
      if (this.isConnected && this.usbDevice && this.isPrinterDevice(this.usbDevice)) {
        try {
          const ep = this.findOutEndpoint();
          await this.usbDevice.transferOut(ep, combinedBuffer);
          console.log('[Printer] ส่งคำสั่งพิมพ์บิลลูกหนี้ 2 ชุดแยกตัดกระดาษผ่าน WebUSB สำเร็จ');
          return { success: true, method: 'webusb-raster-dual' };
        } catch (usbErr) {
          console.warn('[Printer] WebUSB raster print error:', usbErr);
        }
      }

      // 2. Fallback to RawBT Android Print Service (Single unified intent containing both copies and both cuts)
      if (isAndroid) {
        try {
          const b64 = this.uint8ToBase64(combinedBuffer);
          this.dispatchRawBt(b64);

          console.log('[Printer] ส่งคำสั่งพิมพ์บิลลูกหนี้ 2 ชุดผ่าน RawBT (สตรีมเดี่ยวตัดแยก 2 ใบสมบูรณ์) สำเร็จ');
          return { success: true, method: 'rawbt-base64-dual' };
        } catch (rawbtErr) {
          console.warn('[Printer] RawBT base64 dispatch error:', rawbtErr);
        }
      }

      // 3. Fallback to clean iframe print if direct raw interface unavailable
      return this.printReceiptIframe(bill, storeInfo);
    }

    // Normal Single Receipt Print (Cash / QR / etc.)
    const canvas = this.renderReceiptToCanvas(receipt);
    const rasterBytes = this.canvasToEscPosRaster(canvas);

    // 1. Direct WebUSB Transmission (Priority 1: Instant ESC/POS Raster Graphics GS v 0)
    if (this.isConnected && this.usbDevice && this.isPrinterDevice(this.usbDevice)) {
      try {
        const ep = this.findOutEndpoint();
        await this.usbDevice.transferOut(ep, rasterBytes);
        console.log('[Printer] ส่งคำสั่งพิมพ์ Raster Image (GS v 0) ผ่าน WebUSB สำเร็จ');
        this.kickDrawer(false);
        return { success: true, method: 'webusb-raster' };
      } catch (usbErr) {
        console.warn('[Printer] WebUSB raster print error:', usbErr);
      }
    }

    // 2. Fallback to RawBT Android Print Service via Base64 ESC/POS Binary (Crisp Thai/Lao, Exact cut, Zero Chinese garbage)
    if (isAndroid) {
      try {
        const b64 = this.uint8ToBase64(rasterBytes);
        this.dispatchRawBt(b64);
        console.log('[Printer] ส่งคำสั่งพิมพ์ผ่าน RawBT (rawbt:base64,) บน Android สำเร็จ');
        this.kickDrawer(false);
        return { success: true, method: 'rawbt-base64' };
      } catch (rawbtErr) {
        console.warn('[Printer] RawBT base64 dispatch error:', rawbtErr);
      }
    }

    // 3. Fallback to clean iframe print if direct raw interface unavailable
    return this.printReceiptIframe(bill, storeInfo);
  }

  // Print via Browser Window Print with Clean 80mm Styling (Desktop PC Fallback)
  printReceiptIframe(bill, storeInfo = {}) {
    const receipt = this.buildReceiptData(bill, storeInfo);
    const isAR = (receipt.payType === 'ar' || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ลูกหนี้')) || (receipt.payTypeDesc && receipt.payTypeDesc.includes('ລູກໜີ້')));

    if (isAR) {
      // บนเครื่องคอมพิวเตอร์: พิมพ์แยก 2 จ็อบอิสระ เพื่อให้ไดรเวอร์เครื่องพิมพ์ใน Windows สั่งตัดกระดาษขาด 2 ใบ
      const copy1Html = this.renderReceiptHtml(receipt, 'สำหรับลูกค้า / ต้นฉบับ (ສຳລັບລູກຄ້າ)');
      const copy2Html = this.renderReceiptHtml(receipt, 'สำหรับร้านค้า / สำเนาบัญชี (ສຳລັບຮ້ານຄ້າ)');

      this.printSingleHtmlIframe(copy1Html, `Receipt-${receipt.billNo}-Copy1`);
      setTimeout(() => {
        this.printSingleHtmlIframe(copy2Html, `Receipt-${receipt.billNo}-Copy2`);
      }, 1000);
      return;
    }

    const receiptHtml = this.renderReceiptHtml(receipt);

    this.printSingleHtmlIframe(receiptHtml, `Receipt-${receipt.billNo}`);

    // Also trigger drawer kick for cash payments (skip micro-print for AR)
    if (!isAR) {
      this.kickDrawer(false);
    }
  }

  // Print Receipt Unified Entry Point
  printReceipt(bill, storeInfo = {}) {
    // If WebUSB is connected to genuine printer or on Android POS, automatically redirect to instant Raster / RawBT Image Intent
    if ((this.isConnected && this.usbDevice && this.isPrinterDevice(this.usbDevice)) || (typeof window !== 'undefined' && /Android/i.test(navigator.userAgent))) {
      return this.printReceiptRaw(bill, storeInfo);
    }
    return this.printReceiptIframe(bill, storeInfo);
  }

  // Print Single HTML Page via Hidden Iframe (Desktop PC)
  printSingleHtmlIframe(receiptHtml, title = 'Receipt') {
    let printIframe = document.getElementById('print-iframe');
    if (!printIframe) {
      printIframe = document.createElement('iframe');
      printIframe.id = 'print-iframe';
      printIframe.style.position = 'fixed';
      printIframe.style.right = '0';
      printIframe.style.bottom = '0';
      printIframe.style.width = '0';
      printIframe.style.height = '0';
      printIframe.style.border = '0';
      document.body.appendChild(printIframe);
    }

    const doc = printIframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700;800;900&family=Noto+Sans+Lao:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          @page {
            size: 80mm auto;
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
          }
        </style>
      </head>
      <body>
        ${receiptHtml}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 200);
          };
        <\/script>
      </body>
      </html>
    `);
    doc.close();
  }

  // Print Debt Receipt via Hidden Iframe (Desktop PC Fallback)
  printDebtReceiptIframe(paymentData, storeInfo = {}) {
    const storeName = storeInfo.name || 'ร้านหมอน้อยฟู้ด';
    const storeAddress = storeInfo.address || '107 ม.9 ต.หนองแวง อ.นิคมคำสร้อย จ.มุกดาหาร';
    const storePhone = storeInfo.phone || '089-555-1234';
    const footerMsg = storeInfo.footer || 'ขอบคุณที่ชำระหนี้ตรงเวลา ขอขอบพระคุณเป็นอย่างยิ่ง';

    const dateStr = paymentData.timestamp ? new Date(paymentData.timestamp).toLocaleString('th-TH') : new Date().toLocaleString('th-TH');
    const billRef = paymentData.bill_no || '-';
    const customerName = paymentData.customer_name || 'ลูกค้าทั่วไป';
    const cashierName = paymentData.user_id || paymentData.cashier_name || 'ผู้รับเงิน';
    const rateLak = paymentData.rate_lak || 169;
    const amountThb = parseFloat(paymentData.amount_thb || 0);
    const amountLak = parseFloat(paymentData.amount_lak || (amountThb * rateLak));
    const prevDebtThb = parseFloat(paymentData.previous_debt || 0);
    const remainDebtThb = parseFloat(paymentData.remaining_debt || 0);
    const payTypeDesc = paymentData.pay_type_desc || (paymentData.pay_type === 'qr' ? 'โอนเงิน QR' : 'เงินสด (Cash)');

    const receiptHtml = `
      <div id="thermal-receipt-container" style="
        width: 70mm;
        margin: 0 auto;
        padding: 2mm 2.5mm;
        background: #ffffff;
        color: #000000;
        font-family: 'Kanit', 'Noto Sans Lao', 'Saysettha OT', 'Phetsarath OT', Tahoma, sans-serif;
        font-size: 13px;
        line-height: 1.3;
        box-sizing: border-box;
        -webkit-font-smoothing: antialiased;
      ">
        <!-- Store Header -->
        <div style="text-align: center; margin-bottom: 6px;">
          <div style="font-size: 22px; font-weight: 600; letter-spacing: 0; color: #000000;">${storeName}</div>
          <div style="font-size: 10px; color: #000000; margin-top: 2px; white-space: nowrap; letter-spacing: -0.3px;">${storeAddress}</div>
          <div style="font-size: 12px; color: #000000;">โทร: ${storePhone}</div>
          <div style="border-top: 1.5px dashed #000000; margin: 6px 0 5px 0;"></div>
          <div style="font-weight: 600; font-size: 16px; letter-spacing: 0.5px; color: #000000;">ใบเสร็จรับเงิน (รับชำระหนี้)</div>
          <div style="font-weight: 500; font-size: 15px; letter-spacing: 0.5px; margin-top: 1px; color: #000000;">(ໃບຮັບເງິນ - ຊຳລະໜີ້)</div>
          <div style="font-size: 11.5px; font-weight: 600; margin-top: 2px; color: #000000;">[ สำหรับลูกค้า / ต้นฉบับ ]</div>
        </div>

        <!-- Meta Info -->
        <div style="font-size: 12px; color: #000000; margin-bottom: 5px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 4px; white-space: nowrap;">
            <span>บิลอ้างอิง: <strong style="font-weight: 600;">${billRef}</strong></span>
            <span>${dateStr}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 4px; margin-top: 2px; white-space: nowrap;">
            <span>ลูกค้า: <strong style="font-weight: 600;">${customerName}</strong></span>
            <span>ผู้รับเงิน: ${cashierName}</span>
          </div>
        </div>

        <div style="border-top: 1.5px solid #000000; margin-bottom: 5px;"></div>

        <!-- Debt Settlement Details -->
        <div style="font-size: 13.5px; color: #000000; margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
            <span>ยอดหนี้เดิมในบิลนี้:</span>
            <span>฿${prevDebtThb.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px; border-top: 1.5px dashed #000000; border-bottom: 1.5px dashed #000000; padding: 5px 0; margin: 5px 0;">
            <span style="font-size: 15.5px; font-weight: 600; color: #15803d;">ยอดชำระครั้งนี้ (THB):</span>
            <span style="font-size: 19px; font-weight: 600; color: #15803d;">฿${amountThb.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin-bottom: 3px;">
            <span style="font-size: 14px; font-weight: 500;">คิดเป็นเงินกีบ (LAK ₭):</span>
            <span style="font-size: 16.5px; font-weight: 600;">${amountLak.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ₭</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 4px; padding-top: 4px; border-top: 1px dotted #000000; font-size: 14px; font-weight: 600;">
            <span>ยอดหนี้คงเหลือสุทธิ:</span>
            <span style="color: ${remainDebtThb > 0 ? '#b91c1c' : '#15803d'};">฿${remainDebtThb.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 12.5px; margin-top: 4px;">
            <span>ช่องทางชำระ:</span>
            <span>${payTypeDesc}</span>
          </div>
          ${paymentData.note ? `<div style="font-size: 11.5px; color: #444; margin-top: 3px;">หมายเหตุ: ${paymentData.note}</div>` : ''}
        </div>

        <!-- Dual Signature for Debt Receipt -->
        <div style="margin: 8px 0 6px 0; border: 1px dashed #000000; padding: 6px 4px; font-size: 11px;">
          <div style="display: flex; justify-content: space-between; gap: 8px; text-align: center;">
            <div style="flex: 1;">
              <div style="margin-top: 25px; border-bottom: 1px dotted #000000;"></div>
              <div style="margin-top: 4px; font-weight: 600;">( ........................................ )</div>
              <div style="margin-top: 2px;">ผู้ชำระเงิน / ลูกหนี้</div>
            </div>
            <div style="flex: 1;">
              <div style="margin-top: 25px; border-bottom: 1px dotted #000000;"></div>
              <div style="margin-top: 4px; font-weight: 600;">( ........................................ )</div>
              <div style="margin-top: 2px;">ผู้รับเงิน / ร้านค้า</div>
            </div>
          </div>
        </div>

        <div style="border-top: 1.5px dashed #000000; margin-bottom: 5px;"></div>

        <!-- Footer -->
        <div style="text-align: center; font-size: 12px; color: #000000;">
          <div>${footerMsg}</div>
          <div style="margin-top: 3px; font-size: 11px; color: #000000;">ระบบ POSTRACHANG • ร้านหมอน้อยฟู้ด</div>
        </div>
      </div>
    `;

    let printIframe = document.getElementById('print-iframe');
    if (!printIframe) {
      printIframe = document.createElement('iframe');
      printIframe.id = 'print-iframe';
      printIframe.style.position = 'fixed';
      printIframe.style.right = '0';
      printIframe.style.bottom = '0';
      printIframe.style.width = '0';
      printIframe.style.height = '0';
      printIframe.style.border = '0';
      document.body.appendChild(printIframe);
    }

    const doc = printIframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Receipt - Debt Payment - ${billRef}</title>
        <style>
          @page {
            size: 80mm auto;
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
            background: #fff;
            font-family: 'Kanit', 'Noto Sans Thai', Tahoma, Arial, sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
          }
        </style>
      </head>
      <body>
        ${receiptHtml}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 100);
          };
        <\/script>
      </body>
      </html>
    `);
    doc.close();
  }

  // Print 80mm Debt Settlement Receipt - Universal Triple-Engine
  async printDebtReceipt(paymentData, storeInfo = {}) {
    const isAndroid = typeof window !== 'undefined' && /Android/i.test(navigator.userAgent);

    // 1. Direct WebUSB Raster (Only for genuine thermal printer)
    if (this.isConnected && this.usbDevice && this.isPrinterDevice(this.usbDevice)) {
      try {
        const canvas = this.renderDebtReceiptToCanvas(paymentData, storeInfo);
        const rasterBytes = this.canvasToEscPosRaster(canvas);
        const ep = this.findOutEndpoint();
        await this.usbDevice.transferOut(ep, rasterBytes);
        console.log('[Printer] พิมพ์ใบเสร็จรับชำระหนี้ผ่าน WebUSB Raster สำเร็จ');
        this.kickDrawer(false);
        return { success: true, method: 'webusb-raster' };
      } catch (usbErr) {
        console.warn('[Printer] WebUSB raster debt print error:', usbErr);
      }
    }

    // 2. Android RawBT Base64 ESC/POS Binary
    if (isAndroid) {
      try {
        const canvas = this.renderDebtReceiptToCanvas(paymentData, storeInfo);
        const rasterBytes = this.canvasToEscPosRaster(canvas);
        const b64 = this.uint8ToBase64(rasterBytes);
        this.dispatchRawBt(b64);
        console.log('[Printer] ส่งพิมพ์ใบเสร็จรับชำระหนี้ผ่าน RawBT (rawbt:base64,) สำเร็จ');
        this.kickDrawer(false);
        return { success: true, method: 'rawbt-base64' };
      } catch (rawbtErr) {
        console.warn('[Printer] RawBT debt dispatch error:', rawbtErr);
      }
    }

    // 3. Desktop PC Fallback: Clean iframe
    this.printDebtReceiptIframe(paymentData, storeInfo);
    this.kickDrawer(false);
    return { success: true, method: 'browser-iframe' };
  }

  // Print raw HTML via isolated iframe
  printRaw(html) {
    let printIframe = document.getElementById('print-iframe');
    if (!printIframe) {
      printIframe = document.createElement('iframe');
      printIframe.id = 'print-iframe';
      printIframe.style.position = 'fixed';
      printIframe.style.right = '0';
      printIframe.style.bottom = '0';
      printIframe.style.width = '0';
      printIframe.style.height = '0';
      printIframe.style.border = '0';
      document.body.appendChild(printIframe);
    }
    const doc = printIframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>พิมพ์เอกสาร</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          body { font-family: "Sarabun", "Noto Sans Thai", sans-serif; margin: 0; padding: 10px; width: 72mm; color: #000; }
        </style>
      </head>
      <body>
        ${html}
        <script>
          window.onload = function() {
            window.focus();
            window.print();
          };
        <\/script>
      </body>
      </html>
    `);
    doc.close();
  }

  // Print Barcode & QR Code Labels (50x30mm sticker or 80mm continuous receipt)
  printBarcodeLabels(labels, options = {}) {
    const template = options.template || 'sticker-50x30';
    const showQr = options.showQr !== false;
    const showBarcode = options.showBarcode !== false;
    const showLak = options.showLak !== false;
    const copies = parseInt(options.copies) || 1;

    const printWin = window.open('', '_blank', 'width=450,height=600');
    if (!printWin) {
      alert('กรุณาอนุญาตป๊อปอัป (Pop-up) เพื่อพิมพ์บาร์โค้ด');
      return;
    }

    const doc = printWin.document;
    doc.open();

    let pageCss = '';
    let labelItemCss = '';

    if (template === 'sticker-50x30') {
      pageCss = `@page { size: 50mm 30mm; margin: 0; }`;
      labelItemCss = `
        width: 48mm;
        height: 28mm;
        padding: 1mm;
        box-sizing: border-box;
        page-break-after: always;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        text-align: center;
        font-family: 'Kanit', sans-serif;
        overflow: hidden;
      `;
    } else if (template === 'sticker-40x30') {
      pageCss = `@page { size: 40mm 30mm; margin: 0; }`;
      labelItemCss = `
        width: 38mm;
        height: 28mm;
        padding: 1mm;
        box-sizing: border-box;
        page-break-after: always;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        text-align: center;
        font-family: 'Kanit', sans-serif;
        overflow: hidden;
      `;
    } else {
      pageCss = `@page { size: 80mm auto; margin: 2mm 0; }`;
      labelItemCss = `
        width: 72mm;
        margin: 0 auto 6mm auto;
        padding: 4mm 2mm;
        border-bottom: 2px dashed #000;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        font-family: 'Kanit', sans-serif;
      `;
    }

    let labelsHtml = '';
    labels.forEach(item => {
      const codeVal = item.barcode || item.code || '885000000000';
      const nameVal = item.name || '';
      const priceThb = parseFloat(item.price || item.price1 || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
      const priceLak = (parseFloat(item.price || item.price1 || 0) * (item.rateLak || 169)).toLocaleString('th-TH', { maximumFractionDigits: 0 });
      const uomVal = item.uom || 'กก.';
      const storeName = item.storeName || 'ร้านหมอน้อยฟู้ด';

      for (let c = 0; c < copies; c++) {
        labelsHtml += `
          <div class="label-card">
            <div style="font-size: 10px; font-weight: 700; color: #000; line-height: 1.1; margin-bottom: 1px;">${storeName}</div>
            <div style="font-size: 12px; font-weight: 800; color: #000; line-height: 1.2; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 1px;">${nameVal}</div>
            <div class="code-container" style="display: flex; justify-content: ${showBarcode && showQr ? 'space-between' : 'center'}; align-items: flex-start; width: 100%; margin: 1px 0;">
              ${showBarcode ? `
                <div class="barcode-wrapper" style="display: flex; justify-content: ${showQr ? 'flex-start' : 'center'}; align-items: center; flex: 1;">
                  <svg class="barcode-svg" data-barcode="${codeVal}"></svg>
                </div>
              ` : ''}
              ${showQr ? `
                <div class="qr-wrapper" style="display: flex; justify-content: flex-end; align-items: flex-start; margin-top: ${showBarcode ? '-5px' : '0'}; padding-left: 2px;">
                  <div class="qr-box" data-qr="${codeVal}|${nameVal}|${priceThb}"></div>
                </div>
              ` : ''}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; width: 100%; padding: 0 2px; font-weight: 800; margin-top: auto;">
              <span style="font-size: 13px; color: #000;">฿ ${priceThb}</span>
              ${showLak ? `<span style="font-size: 10px; color: #333;">(${priceLak} ₭)</span>` : ''}
              <span style="font-size: 9.5px; font-weight: 600; color: #444;">/${uomVal}</span>
            </div>
          </div>
        `;
      }
    });

    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Barcode & QR Labels</title>
        <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;600;700;800&display=swap" rel="stylesheet">
        <script src="lib/JsBarcode.all.min.js"><\/script>
        <script src="lib/qrcode.min.js"><\/script>
        <style>
          ${pageCss}
          body {
            margin: 0;
            padding: 0;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .label-card {
            ${labelItemCss}
          }
          .barcode-svg {
            max-width: 100%;
            height: 30px;
          }
          .qr-box {
            display: inline-block;
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
        <script>
          window.onload = function() {
            document.querySelectorAll('.barcode-svg').forEach(function(el) {
              try {
                JsBarcode(el, el.getAttribute('data-barcode'), {
                  format: "CODE128",
                  width: ${showQr ? 1.15 : 1.5},
                  height: 28,
                  displayValue: true,
                  fontSize: 9.5,
                  margin: 0
                });
              } catch(e) {
                console.warn('Barcode render error:', e);
              }
            });

            document.querySelectorAll('.qr-box').forEach(function(el) {
              try {
                new QRCode(el, {
                  text: el.getAttribute('data-qr'),
                  width: ${showBarcode ? 48 : 56},
                  height: ${showBarcode ? 48 : 56},
                  correctLevel: QRCode.CorrectLevel.M
                });
              } catch(e) {
                console.warn('QR render error:', e);
              }
            });

            setTimeout(function() {
              window.print();
            }, 400);
          };
        <\/script>
      </body>
      </html>
    `);
    doc.close();
  }
}

// Global Singleton Instance
window.printerService = new PrinterService();
