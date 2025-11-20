// src/print/print.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { print } from 'pdf-to-printer';
import * as fs from 'fs';
import { join } from 'path';
import PDFDocument = require('pdfkit');
import * as QRCode from 'qr-image'; // ← QR-kod uchun
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class PrintService {
  private readonly API_URL = "http://192.168.1.45:5500";
  private readonly TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsIm5hbWUiOiJBZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc1NzU3NTA4NzgxLCJleHAiOjE3NTc1OTUxODF9.WMtgua3T6eoJvTLQjCG5Q_BgKQMCtsU8f86E9Ai0GA8';

  constructor(private readonly http: HttpService) {}

  // === Oshxona uchun eski funksiya (o‘zgarmadi) ===
 async printKitchenOrder(order: any): Promise<string> {
    const pdfPath = join(process.cwd(), `kitchen-order-${order.id}.pdf`);
  
    if (!order.items || !Array.isArray(order.items)) {
      console.error('❌ Order.items topilmadi yoki noto‘g‘ri format:', order);
      return '⚠️ Buyurtma ichida itemlar yo‘q!';
    }
  
    // 🔹 faqat chop etilmagan yangi itemlar
    const itemsToPrint = order.items.filter(
      (item) => !item.isPrinted && item.status !== 'canceled'
    );
  
    // 🔹 canceled bo‘lgan itemlar (isPrinted bo‘lsa ham qaytadan chiqishi kerak)
    const canceledItems = order.items.filter(
      (item) => !item.isPrinted && item.status === 'canceled'
    );
  
    if (itemsToPrint.length === 0 && canceledItems.length === 0) {
      return 'ℹ️ Yangi ham, bekor qilingan ham taom yo‘q.';
    }
  
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({
        size: [240, 600],
        margins: { top: 10, left: 5, right: 5, bottom: 10 },
      });
  
      const fontPath = join(process.cwd(), 'fonts', 'DejaVuSans.ttf');
      doc.font(fontPath);
  
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);
  
      // 🔹 Sarlavha
      doc.fontSize(16).text('CHEK - Oshxona', { align: 'center' });
      doc.moveDown();
  
      // 🔹 Buyurtma haqida
      doc.fontSize(12).text(`Stol: ${order.table?.table_number} (${order.table?.location})`);
      doc.text(`Ofitsiant: ${order.user?.name || 'Nomaʼlum'}`);
      doc.text(`Vaqt: ${new Date(order.createdAt).toLocaleString()}`);
      doc.moveDown();
      doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
  
      // 🔹 birliklar uchun lug‘at
      const unitLabels: Record<string, string> = {
        piece: 'ta',
        kg: 'kg',
        gr: 'gr',
        liter: 'litr',
      };
  
      const formatQuantity = (qty: any) => {
        const num = Number(qty);
        if (isNaN(num)) return qty;
        return Number.isInteger(num) ? num.toString() : num.toFixed(2);
      };
  
      // 🔹 Yangi itemlar
      if (itemsToPrint.length > 0) {
        doc.moveDown().fontSize(14).text(' Yangi buyurtmalar:', { underline: true });
  
        itemsToPrint.forEach((item) => {
          const unit = unitLabels[item.product.unitType] || item.product.unitType || '';
          const qty = formatQuantity(item.quantity);
          doc.fontSize(14).text(`${qty} ${unit} x ${item.product?.name ?? 'Noma’lum'}`);
        });
      }
  
      // 🔹 Bekor qilingan itemlar
      if (canceledItems.length > 0) {
        doc.moveDown().fontSize(14).fillColor('red').text('❌ Bekor qilingan:', { underline: true });
  
        canceledItems.forEach((item) => {
          const unit = unitLabels[item.product.unitType] || item.product.unitType || '';
          const qty = formatQuantity(item.quantity);
          doc.fontSize(14).text(`${qty} ${unit} x ${item.product?.name ?? 'Noma’lum'}`);
        });
  
        doc.fillColor('black');
      }
  
      doc.end();
  
      stream.on('finish', () => resolve());
      stream.on('error', (err) => reject(err));
    });
  
    // 🔹 printerga chiqarish
    await print(pdfPath, { printer: `${process.env.CITCHEN_PRINTER}` });
    fs.unlinkSync(pdfPath);
  
    // 🔹 Yangi itemlarni isPrinted = true qilish
// 🔹 Yangi va bekor qilingan itemlarni isPrinted = true qilish
const printedItems = [...itemsToPrint, ...canceledItems];
for (const item of printedItems) {
  try {
    await this.http.put(
      `${this.API_URL}/order-items/${item.id}`,
      { isPrinted: true },
      { headers: { Authorization: `Bearer ${this.TOKEN}` } }
    ).toPromise();
  } catch (err: any) {
    console.error(`❌ Item #${item.id} update bo‘lmadi:`, err.message);
  }
}

  
    return '✅ Oshxona uchun buyurtma chiqarildi!';
  }
  

async printCustomerCheckSocket(check: any): Promise<string> {
  const fileSafeName = check.user?.name?.replace(/\s+/g, "_") || `order-${check.orderId}`;
  const pdfPath = join(process.cwd(), `customer-check-${fileSafeName}.pdf`);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [270, 1000], // 80mm printer uchun ideal
      margins: { top: 20, left: 15, right: 15, bottom: 20 },
    });

    const fontPath = join(process.cwd(), "fonts", "DejaVuSans.ttf");
    const regularFont = fs.existsSync(fontPath) ? fontPath : 'Helvetica';
    const boldFont = fs.existsSync(fontPath) ? fontPath : 'Helvetica-Bold';

    doc.font(regularFont);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // ====================== LOGO ======================
    const logoPath = join(process.cwd(), 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, {
        fit: [140, 100],
        align: 'center',
        valign: 'center',
      });
      doc.moveDown(1);
    }

    // ====================== RESTORAN NOMI ======================
    doc.fontSize(20).font(boldFont).text("Super Ofitsiant", { align: "center" });
    doc.fontSize(11).text("Eng mazali palov va shashlik uyi!", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(18).font(boldFont).text("CHEK", { align: "center" });
    doc.fontSize(10).text("Mijoz nusxasi", { align: "center" });
    doc.moveDown(1);
    doc.moveTo(15, doc.y).lineTo(255, doc.y).lineWidth(2).stroke();
    doc.moveDown(1);

    // ====================== BUYURTMA MA'LUMOTLARI ======================
    doc.fontSize(11);
    doc.text(`Stol: ${check.table || 'Nomaʼlum'}`, { align: "center" });
    doc.text(`Ofitsiant: ${check.paidByName || 'Nomaʼlum'}`, { align: "center" });
    doc.text(`Vaqt: ${new Date(check.orderTime).toLocaleString('uz-UZ')}`, { align: "center" });
    doc.moveDown(1.2);
    doc.moveTo(15, doc.y).lineTo(255, doc.y).lineWidth(1).stroke();
    doc.moveDown(1.5);

    // ====================== MAHSULOTLAR BIRLASHTIRISH ======================
    const mergedItems: Record<string, { name: string; price: number; quantity: number; total: number; unit: string }> = {};

    check.items.forEach((item: any) => {
      const key = `${item.productName}-${item.unitType || 'piece'}`;
      if (!mergedItems[key]) {
        mergedItems[key] = {
          name: item.productName || "Nomaʼlum",
          price: Number(item.price || item.total / item.quantity),
          quantity: 0,
          total: 0,
          unit: item.unitType || 'piece',
        };
      }
      mergedItems[key].quantity += Number(item.quantity || 1);
      mergedItems[key].total += Number(item.total || 0);
    });

    const unitLabels: Record<string, string> = {
      piece: "ta",
      kg: "kg",
      gr: "gr",
      liter: "litr",
    };

    // ====================== HAR BIR MAHSULOTNI CHIROYLI CHIQARISH ======================
    doc.fontSize(13).font(boldFont);

    Object.values(mergedItems).forEach((item) => {
      const unit = unitLabels[item.unit] || item.unit || "ta";
      const qty = item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2);

      // Mahsulot nomi
      doc.fontSize(13).font(boldFont).text(item.name, { align: "center" });

      // Narx x Miqdor = Jami
      const line = `${item.price.toLocaleString()} x ${qty} ${unit} = ${item.total.toLocaleString()} so‘m`;
      doc.fontSize(12.5).font(regularFont).text(line, { align: "center" });

      // Ajratuvchi chiziq
      doc.moveDown(0.5);
      doc.moveTo(30, doc.y).lineTo(240, doc.y).lineWidth(0.8).dash(5, { space: 3 }).stroke();
      doc.moveDown(1);
    });

    // ====================== JAMI SUMMA ======================
    doc.moveDown(1);
    doc.moveTo(15, doc.y).lineTo(255, doc.y).lineWidth(2).stroke();
    doc.moveDown(0.8);

    const totalText = `JAMI: ${Number(check.paidAmount || check.totalAmount).toLocaleString()} so‘m`;
    doc.fontSize(18).font(boldFont).text(totalText, { align: "center" });

    if (check.serviceFee > 0) {
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Xizmat haqi: ${Number(check.serviceFee).toLocaleString()} so‘m`, { align: "center" });
    }

    doc.moveDown(2);

// console.log("Chek raqami:", JSON.stringify(check, null, 2));


    // ====================== QR KOD ======================
    const qrUrl = `http://192.168.1.45:3000/ru/payments/check/${check.id}`;
    const qrBuffer = QRCode.imageSync(qrUrl, { type: 'png', size: 5, margin: 2 });

    doc.image(qrBuffer, {
      fit: [140, 140],
      align: 'center',
      valign: 'center',
    });

    doc.moveDown(0.7);
    doc.fontSize(11).text("Chekni telefoningizda ko‘rish uchun", { align: "center" });
    doc.fontSize(12).font(boldFont).text("QR-kodni skanerlang", { align: "center" });

    doc.moveDown(2);

    // ====================== RAHMAT MATNI ======================
    doc.fontSize(16).font(boldFont).text("RAHMAT!", { align: "center" });
    doc.fontSize(12).text("Sizni yana kutib qolamiz!", { align: "center" });
    doc.fontSize(10).text("★ Super Ofitsiant – Har bir taom – sanʼat asari! ★", { align: "center" });

    doc.end();

    stream.on('finish', async () => {
      try {
        await print(pdfPath, { printer: 'XP-80C' }); // o‘zingiznikiga moslashtiring
        fs.unlinkSync(pdfPath);
        console.log('✅ Yangi formatdagi chek chiqarildi!');
        resolve('✅ Chek muvaffaqiyatli chiqdi!');
      } catch (err) {
        console.error('Printer xatosi:', err);
        reject(err);
      }
    });

    stream.on('error', (err) => {
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      reject(err);
    });
  });
}
}