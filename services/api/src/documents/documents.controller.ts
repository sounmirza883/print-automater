import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import {
  DocumentsService,
  type CreateDocumentResult,
  type DocumentStatusView,
} from "./documents.service.js";
import { CreateDocumentDto } from "./dto/create-document.dto.js";

@Controller("documents")
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  create(
    @Req() req: RequestWithUser,
    @Body() dto: CreateDocumentDto,
  ): Promise<CreateDocumentResult> {
    return this.documentsService.create(req.user!.id, dto);
  }

  @Post(":id/upload")
  @HttpCode(HttpStatus.OK)
  confirmUpload(@Req() req: RequestWithUser, @Param("id") id: string): Promise<DocumentStatusView> {
    return this.documentsService.confirmUpload(id, req.user!.id);
  }

  @Get(":id")
  getStatus(@Req() req: RequestWithUser, @Param("id") id: string): Promise<DocumentStatusView> {
    return this.documentsService.getStatus(id, req.user!.id);
  }

  /** §65: authenticated streaming endpoint, never a presigned or
   * otherwise permanent URL -- the decrypted bytes flow through this
   * API on every request, not from a link the client could reuse or
   * share past this one authenticated call. */
  @Get(":id/download")
  async download(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.documentsService.download(id, req.user!.id);
    res
      .status(HttpStatus.OK)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(buffer.length),
      })
      .send(buffer);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: RequestWithUser, @Param("id") id: string): Promise<void> {
    return this.documentsService.remove(id, req.user!.id);
  }
}
