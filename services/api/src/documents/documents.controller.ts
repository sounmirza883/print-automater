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
  UseGuards,
} from "@nestjs/common";
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

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: RequestWithUser, @Param("id") id: string): Promise<void> {
    return this.documentsService.remove(id, req.user!.id);
  }
}
