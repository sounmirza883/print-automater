import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AppException, PrismaService, redactMetadata } from "@print-automated/backend-shared";
import type { PaymentReportResponse } from "@print-automated/types";
import type {
  PaymentReportExportQueryInput,
  PaymentReportQueryInput,
} from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { toCsv } from "../reports/csv.js";
import {
  PAYMENT_EXPORT_COLUMNS,
  buildPaymentReport,
  chooseGroupBy,
  paymentExportRows,
  summarySheetRows,
  type ReportProof,
} from "./payment-report.js";
import { XLSX_CONTENT_TYPE, buildXlsx } from "./xlsx.js";

/** Written as an escape on purpose: a literal byte-order mark in source is invisible. */
const UTF8_BOM = String.fromCharCode(0xfeff);

/** More rows than this in one report is a sign the range is wrong, not a report anyone reads. */
const MAX_REPORT_ROWS = 50_000;

const TOO_MANY_ROWS = (): AppException =>
  new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    "PAYMENT_REPORT_TOO_LARGE",
    "That range holds too many payments to report at once. Choose a shorter range.",
    false,
  );

export interface ReportFile {
  bytes: Buffer;
  contentType: string;
  fileName: string;
}

/** Admin payment reports: how much plan money was received (approved payment proofs) and not
 * accepted (rejected ones) over a range, as totals per day/month and as a CSV or Excel file with
 * one row per payment. Read-only; the numbers come from the same `payment_proofs` rows the review
 * queue shows. */
@Injectable()
export class PaymentReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: PaymentReportQueryInput): Promise<PaymentReportResponse> {
    const proofs = await this.fetch(query.from, query.to);
    return buildPaymentReport(proofs, {
      from: query.from,
      to: query.to,
      groupBy: chooseGroupBy(query.from, query.to, query.groupBy),
      tzOffsetMinutes: query.tzOffsetMinutes,
    });
  }

  async export(query: PaymentReportExportQueryInput, adminUserId: string): Promise<ReportFile> {
    const proofs = await this.fetch(query.from, query.to);
    const rows = paymentExportRows(proofs, query);
    const stamp = (date: Date): string =>
      new Date(date.getTime() + query.tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
    // `to` is exclusive: name the file by the last day it actually covers.
    const lastDay = new Date(query.to.getTime() - 1);
    const base = `payments_${stamp(query.from)}_to_${stamp(lastDay)}`;

    await this.prisma.auditLog.create({
      data: {
        actorId: adminUserId,
        action: AuditAction.PAYMENT_REPORT_EXPORTED,
        resourceType: "payment_report",
        resourceId: base,
        metadata: redactMetadata({
          from: query.from.toISOString(),
          to: query.to.toISOString(),
          format: query.format,
          rows: rows.length,
        }) as Prisma.InputJsonValue,
      },
    });

    if (query.format === "csv") {
      // The BOM makes Excel read the file as UTF-8 (business names are not always ASCII).
      const csv = `${UTF8_BOM}${toCsv(rows, [...PAYMENT_EXPORT_COLUMNS])}`;
      return {
        bytes: Buffer.from(csv, "utf8"),
        contentType: "text/csv; charset=utf-8",
        fileName: `${base}.csv`,
      };
    }

    const report = buildPaymentReport(proofs, {
      from: query.from,
      to: query.to,
      groupBy: chooseGroupBy(query.from, query.to, query.groupBy),
      tzOffsetMinutes: query.tzOffsetMinutes,
    });
    return {
      bytes: buildXlsx([
        { name: "Summary", rows: summarySheetRows(report) },
        {
          name: "Payments",
          rows: [
            [...PAYMENT_EXPORT_COLUMNS],
            ...rows.map((row) => PAYMENT_EXPORT_COLUMNS.map((column) => row[column])),
          ],
        },
      ]),
      contentType: XLSX_CONTENT_TYPE,
      fileName: `${base}.xlsx`,
    };
  }

  /** Proofs decided in [from, to), plus those submitted in it and still waiting. */
  private async fetch(from: Date, to: Date): Promise<ReportProof[]> {
    const rows = await this.prisma.paymentProof.findMany({
      where: {
        OR: [
          { status: { in: ["APPROVED", "REJECTED"] }, reviewedAt: { gte: from, lt: to } },
          { status: "PENDING", createdAt: { gte: from, lt: to } },
        ],
      },
      include: { shop: { select: { name: true } }, planDefinition: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: MAX_REPORT_ROWS + 1,
    });
    if (rows.length > MAX_REPORT_ROWS) {
      throw TOO_MANY_ROWS();
    }
    return rows.map((row) => ({
      status: row.status,
      amountMinor: row.amountMinor,
      currency: row.currency,
      planName: row.planDefinition.name,
      shopName: row.shop.name,
      transactionRef: row.transactionRef,
      grantedMonths: row.grantedMonths,
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
    }));
  }
}
