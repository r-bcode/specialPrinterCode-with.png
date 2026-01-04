// src/print/print.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { print } from 'pdf-to-printer';
import * as fs from 'fs';
import { join } from 'path';
import PDFDocument = require('pdfkit');
// import * as QRCode from 'qr-image'; // ← QR-kod uchun
import * as dotenv from 'dotenv';

dotenv.config();

const CATEGORY_PRINTER_MAP: Record<number, string> = {
  6: process.env.DRINKS_PRINTER!, // 🥤 Ichimliklar
  7: process.env.GRILL_PRINTER!,  // 🔥 Lavash
  9: process.env.GRILL_PRINTER!,  // 🔥 Shashlik
  10: process.env.SALAD_PRINTER!, // 🥗 Salatlar
};

const DEFAULT_PRINTER = process.env.CITCHEN_PRINTER!;

@Injectable()
export class PrintService {
  private readonly API_URL = process.env.BEST_URL;
  private readonly TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsIm5hbWUiOiJBZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc1NzU3NTA4NzgxLCJleHAiOjE3NTc1OTUxODF9.WMtgua3T6eoJvTLQjCG5Q_BgKQMCtsU8f86E9Ai0GA8';

  constructor(private readonly http: HttpService) {}

  
  async printForSinglePrinter(
  order: any,
  items: any[],
  canceledItems: any[],
  printerName: string
) {
  if (items.length === 0 && canceledItems.length === 0) return;

  const pdfPath = join(
    process.cwd(),
    `kitchen-${printerName}-${Date.now()}.pdf`
  );

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({
      size: [240, 600],
      margins: { top: 10, left: 5, right: 5, bottom: 10 },
    });

    const fontPath = join(process.cwd(), 'fonts', 'DejaVuSans.ttf');
    doc.font(fontPath);

    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // 🔹 HEADER
    doc.fontSize(16).text('CHEK - OSHXONA', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12)
      .text(`Stol: ${order.table?.table_number}`)
      .text(`Ofitsiant: ${order.user?.name || 'Nomaʼlum'}`)
      .text(`Vaqt: ${new Date().toLocaleString()}`);

    doc.moveDown();
    doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();

    const unitLabels: Record<string, string> = {
      piece: 'ta',
      kg: 'kg',
      gr: 'gr',
      liter: 'l',
    };

const formatQty = (q: any) => {
  const num = Number(q);
  if (Number.isNaN(num)) return q;
  return num % 1 === 0 ? num.toString() : num.toFixed(2);
};

    // 🔹 YANGI ITEMLAR
    if (items.length > 0) {
      doc.moveDown().fontSize(14).text('Yangi:', { underline: true });

      items.forEach(item => {
        const unit =
          unitLabels[item.product.unitType] ||
          item.product.unitType ||
          '';
        doc.text(
          `${formatQty(item.quantity)} ${unit} x ${item.product.name}`
        );
      });
    }

    // 🔹 BEKOR QILINGAN
    if (canceledItems.length > 0) {
      doc.moveDown()
        .fontSize(14)
        .fillColor('red')
        .text('❌ Bekor qilingan:', { underline: true });

      canceledItems.forEach(item => {
        const unit =
          unitLabels[item.product.unitType] ||
          item.product.unitType ||
          '';
        doc.text(
          `${formatQty(item.quantity)} ${unit} x ${item.product.name}`
        );
      });

      doc.fillColor('black');
    }

    doc.end();

    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  await print(pdfPath, { printer: printerName });
  fs.unlinkSync(pdfPath);
}

  // === Oshxona uchun eski funksiya (o‘zgarmadi) ===
async printKitchenOrder(order: any): Promise<string> {
  if (!order.items || !Array.isArray(order.items)) {
    return '⚠️ Buyurtmada itemlar yo‘q';
  }

  // 🔹 print qilinadigan itemlar
  const itemsToPrint = order.items.filter(
    item => !item.isPrinted && item.status !== 'canceled'
  );

  const canceledItems = order.items.filter(
    item => !item.isPrinted && item.status === 'canceled'
  );

  if (itemsToPrint.length === 0 && canceledItems.length === 0) {
    return 'ℹ️ Chop etiladigan taom yo‘q';
  }

  // 🔹 printer bo‘yicha guruhlash
  const printerGroups: Record<
    string,
    { items: any[]; canceled: any[] }
  > = {};

  const pushToGroup = (item: any, isCanceled = false) => {
    const categoryId = item.product?.categoryId;
    const printer =
      CATEGORY_PRINTER_MAP[categoryId] || DEFAULT_PRINTER;

    if (!printerGroups[printer]) {
      printerGroups[printer] = { items: [], canceled: [] };
    }

    isCanceled
      ? printerGroups[printer].canceled.push(item)
      : printerGroups[printer].items.push(item);
  };

  itemsToPrint.forEach(item => pushToGroup(item));
  canceledItems.forEach(item => pushToGroup(item, true));

  // 🔹 har bir printerga alohida chiqarish
  for (const [printerName, data] of Object.entries(printerGroups)) {
    await this.printForSinglePrinter(
      order,
      data.items,
      data.canceled,
      printerName
    );
  }

  // 🔹 isPrinted = true qilish
  const printedItems = [...itemsToPrint, ...canceledItems];

  for (const item of printedItems) {
    try {
      await this.http.put(
        `${this.API_URL}/order-items/${item.id}`,
        { isPrinted: true },
        { headers: { Authorization: `Bearer ${this.TOKEN}` } }
      ).toPromise();
    } catch (err: any) {
      console.error(`❌ Item #${item.id} update bo‘lmadi`);
    }
  }

  console.log('CATEGORY_PRINTER_MAP:', CATEGORY_PRINTER_MAP);
console.log('DEFAULT_PRINTER:', DEFAULT_PRINTER);

itemsToPrint.forEach(item => {
  console.log('Item:', item.product.name, 'categoryId:', item.product.categoryId, 'type:', typeof item.product.categoryId);
  const printer = CATEGORY_PRINTER_MAP[item.product.categoryId] || DEFAULT_PRINTER;
  console.log('→ Printer:', printer);
});

  return '✅ Buyurtma printerlarga chiqarildi';
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
    // const logoPath = join(process.cwd(), 'public', 'logo.png');
    // if (fs.existsSync(logoPath)) {
    //   doc.image(logoPath, {
    //     fit: [140, 100],
    //     align: 'center',
    //     valign: 'center',
    //   });
    //   doc.moveDown(1);
    // }

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

        if (check.serviceFee > 0) {
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Xizmat haqi (10%): ${Number(check.serviceFee).toLocaleString()} so‘m`, { align: "center" });
    }

    const totalText = `JAMI: ${Number(check.paidAmount || check.totalAmount).toLocaleString()} so‘m`;
    doc.fontSize(18).font(boldFont).text(totalText, { align: "center" });



    doc.moveDown(2);

// console.log("Chek raqami:", JSON.stringify(check, null, 2));


    // ====================== QR KOD ======================
    // const qrUrl = `https://so.plow.uz/ru/payments/check/${check.id}`;
    // const qrBuffer = QRCode.imageSync(qrUrl, { type: 'png', size: 5, margin: 2 });

    // doc.image(qrBuffer, {
    //   fit: [140, 140],
    //   align: 'center',
    //   valign: 'center',
    // });

    // doc.moveDown(0.7);
    // doc.fontSize(11).text("Chekni telefoningizda ko‘rish uchun", { align: "center" });
    // doc.fontSize(12).font(boldFont).text("QR-kodni skanerlang", { align: "center" });

    // doc.moveDown(2);

    // ====================== RAHMAT MATNI ======================
    doc.fontSize(16).font(boldFont).text("RAHMAT!", { align: "center" });
    doc.fontSize(12).text("Sizni yana kutib qolamiz!", { align: "center" });
    doc.fontSize(10).text("★ Super Ofitsiant – Har bir taom – sanʼat asari! ★", { align: "center" });

    doc.end();

    stream.on('finish', async () => {
      try {
        await print(pdfPath, { printer: process.env.CUSTOMER_PRINTER }); // o‘zingiznikiga moslashtiring
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