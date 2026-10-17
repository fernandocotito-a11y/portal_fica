/* ============================================================================
   pdfReportsService.js — Boletas y certificados en PDF (+ ZIP masivo)
   ----------------------------------------------------------------------------
   - Boleta de Pago bajo formato legal D.S. 001-98-TR (individual o masiva ZIP).
   - Certificado de Depósito de CTS semestral.
   - Certificado de Liquidación de Beneficios Sociales (LBS).
   Usa jsPDF y JSZip cargados desde CDN (ESM) de forma diferida.
   ========================================================================== */

import { APP } from '../../js/config.js';
import { money, sanitizeText, downloadBlob, fmtDate } from './payrollUtils.js';
import { MESES } from './payrollConfig.js';

async function loadJsPDF() {
  const mod = await import('https://esm.sh/jspdf@2');
  return mod.jsPDF || mod.default;
}
async function loadJSZip() {
  const mod = await import('https://esm.sh/jszip@3');
  return mod.default || mod;
}

/** Dibuja la cabecera institucional y devuelve la coordenada Y siguiente. */
function drawHeader(doc, company, title) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(62, 39, 35); // marrón corporativo
  doc.rect(0, 0, W, 58, 'F');
  doc.setTextColor(255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(company?.name || APP.company, 40, 26);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`RUC: ${company?.ruc || '—'}`, 40, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(title, W - 40, 30, { align: 'right' });
  doc.setTextColor(26);
  return 78;
}

/** Construye la boleta de pago (D.S. 001-98-TR). */
export function payslipDoc(JsPDF, employee, period, calc, company) {
  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = drawHeader(doc, company, 'BOLETA DE PAGO');

  doc.setFontSize(9);
  doc.text(`Período: ${MESES[period.month - 1]} ${period.year}`, 40, y);
  y += 16;
  doc.setDrawColor(231, 224, 216);
  doc.line(40, y, W - 40, y);
  y += 18;

  doc.setFont('helvetica', 'bold');
  doc.text('Trabajador:', 40, y);
  doc.setFont('helvetica', 'normal');
  doc.text(sanitizeText(employee.name), 110, y);
  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.text('Documento:', 40, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`${employee.docType} ${employee.docNumber}`, 110, y);
  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.text('Cargo:', 40, y);
  doc.setFont('helvetica', 'normal');
  doc.text(sanitizeText(employee.position || '—'), 110, y);
  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.text('Régimen:', 40, y);
  doc.setFont('helvetica', 'normal');
  doc.text(employee.pensionType === 'AFP' ? `AFP ${employee.afp}` : 'ONP', 110, y);
  y += 24;

  // Tablas de ingresos / descuentos
  const colW = (W - 80) / 2;
  const leftX = 40;
  const rightX = 40 + colW + 10;
  const rowH = 16;

  doc.setFillColor(245, 239, 235);
  doc.rect(leftX, y, colW, rowH + 4, 'F');
  doc.rect(rightX, y, colW, rowH + 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text('INGRESOS', leftX + 6, y + 14);
  doc.text('DESCUENTOS', rightX + 6, y + 14);
  y += rowH + 8;

  const earnings = [
    ['Sueldo básico', calc.basico],
    ['Asignación familiar', calc.asigFamiliar],
    ['Rem. vacacional', calc.vacaciones],
    ['Bonificaciones', calc.bonificaciones],
  ];
  const discounts = [
    ['Pensión', calc.pension],
    ['Renta 5ta categoría', calc.renta5ta],
    ['Tardanzas / faltas', calc.tardanzas],
    ['Préstamos / adelantos', calc.prestamos],
  ];

  doc.setFont('helvetica', 'normal');
  const maxRows = Math.max(earnings.length, discounts.length);
  let ty = y;
  for (let i = 0; i < maxRows; i++) {
    if (earnings[i]) {
      doc.text(earnings[i][0], leftX + 6, ty);
      doc.text(money(earnings[i][1]), leftX + colW - 6, ty, { align: 'right' });
    }
    if (discounts[i]) {
      doc.text(discounts[i][0], rightX + 6, ty);
      doc.text(money(discounts[i][1]), rightX + colW - 6, ty, { align: 'right' });
    }
    ty += rowH;
  }
  y = ty + 6;
  doc.setDrawColor(231, 224, 216);
  doc.line(leftX, y, W - 40, y);
  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.text('Total bruto', leftX + 6, y);
  doc.text(money(calc.totalBruto), leftX + colW - 6, y, { align: 'right' });
  doc.text('Total descuentos', rightX + 6, y);
  doc.text(money(calc.totalRetenciones), rightX + colW - 6, y, { align: 'right' });
  y += 26;

  doc.setFillColor(62, 39, 35);
  doc.rect(leftX, y, W - 80, 30, 'F');
  doc.setTextColor(255);
  doc.setFontSize(12);
  doc.text('NETO A PAGAR', leftX + 10, y + 20);
  doc.text(money(calc.neto), W - 50, y + 20, { align: 'right' });
  doc.setTextColor(26);
  doc.setFontSize(9);

  y += 50;
  doc.text('Aportes del empleador (informativo): Essalud ' + money(calc.essalud) + ' · Vida Ley ' + money(calc.vidaLey), 40, y);
  y += 40;
  doc.setDrawColor(120);
  doc.line(60, y, 240, y);
  doc.line(W - 240, y, W - 60, y);
  doc.text('Empleador', 130, y + 12, { align: 'center' });
  doc.text('Trabajador', W - 150, y + 12, { align: 'center' });

  return doc;
}

export const pdfReportsService = {
  async downloadPayslip(employee, period, calc, company) {
    const JsPDF = await loadJsPDF();
    const doc = payslipDoc(JsPDF, employee, period, calc, company);
    const name = `BOLETA_${sanitizeText(employee.name).replace(/\s+/g, '_')}_${period.year}${String(period.month).padStart(2, '0')}.pdf`;
    doc.save(name);
  },

  /** Genera todas las boletas del período en un ZIP. */
  async downloadMassPayslipsZip(rows, period, company) {
    const JsPDF = await loadJsPDF();
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    rows.forEach(({ employee, calc }) => {
      const doc = payslipDoc(JsPDF, employee, period, calc, company);
      const name = `BOLETA_${sanitizeText(employee.name).replace(/\s+/g, '_')}_${period.year}${String(period.month).padStart(2, '0')}.pdf`;
      zip.file(name, doc.output('blob'));
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(`BOLETAS_${period.year}${String(period.month).padStart(2, '0')}.zip`, blob);
  },

  /** Certificado de depósito de CTS semestral. */
  async downloadCtSCertificate(employee, period, cts, company) {
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    let y = drawHeader(doc, company, 'CONSTANCIA DE DEPÓSITO DE CTS');
    doc.setFontSize(10);
    doc.text(`Período: ${period.semestre || period.year}`, 40, y);
    y += 20;
    doc.text(`Trabajador: ${sanitizeText(employee.name)}`, 40, y);
    y += 16;
    doc.text(`Documento: ${employee.docType} ${employee.docNumber}`, 40, y);
    y += 16;
    doc.text(`Sueldo básico: ${money(cts.base)}`, 40, y);
    y += 16;
    doc.text(`Días computables: ${cts.diasComputables}`, 40, y);
    y += 24;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`Monto depositado: ${money(cts.monto)}`, 40, y);
    y += 40;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Emitido el ${fmtDate(new Date().toISOString())}.`, 40, y);
    doc.save(`CTS_${sanitizeText(employee.name).replace(/\s+/g, '_')}.pdf`);
  },

  /** Certificado de Liquidación de Beneficios Sociales. */
  async downloadLbsCertificate(liq, company) {
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    let y = drawHeader(doc, company, 'LIQUIDACIÓN DE BENEFICIOS SOCIALES');
    const rows = [
      ['Trabajador', sanitizeText(liq.employee.name)],
      ['Documento', `${liq.employee.docType} ${liq.employee.docNumber}`],
      ['Fecha de cese', liq.fechaCese || '—'],
      ['CTS trunca', money(liq.cts.monto)],
      ['Vacaciones truncas', money(liq.vacaciones.truncas)],
      ['Vacaciones pendientes', money(liq.vacaciones.pendientes)],
      ['Gratificación trunca', money(liq.gratificacion.monto)],
      ['Bonificación extraordinaria', money(liq.gratificacion.bonoExtra)],
      ['Deducciones', money(liq.deducciones.total)],
    ];
    doc.setFontSize(10);
    rows.forEach(([k, v]) => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${k}:`, 40, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(v), 220, y);
      y += 18;
    });
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`NETO A PAGAR: ${money(liq.neto)}`, 40, y);
    y += 60;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setDrawColor(120);
    doc.line(60, y, 240, y);
    doc.line(W - 240, y, W - 60, y);
    doc.text('Empleador', 130, y + 12, { align: 'center' });
    doc.text('Trabajador', W - 150, y + 12, { align: 'center' });
    doc.save(`LIQUIDACION_${sanitizeText(liq.employee.name).replace(/\s+/g, '_')}.pdf`);
  },
};
