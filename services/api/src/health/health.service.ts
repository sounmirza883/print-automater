import { Inject, Injectable } from "@nestjs/common";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type Redis from "ioredis";
import type { ApiEnv } from "@print-automated/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { REDIS_CLIENT } from "../redis/redis.module.js";
import { S3_CLIENT } from "../storage/storage.tokens.js";
import { API_ENV } from "../config/config.module.js";

export interface DependencyCheck {
  name: "postgres" | "redis" | "s3";
  ok: boolean;
  error?: string;
}

export interface ReadinessResult {
  ready: boolean;
  checks: DependencyCheck[];
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async checkReadiness(): Promise<ReadinessResult> {
    const checks = await Promise.all([this.checkPostgres(), this.checkRedis(), this.checkS3()]);
    return { ready: checks.every((check) => check.ok), checks };
  }

  private async checkPostgres(): Promise<DependencyCheck> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { name: "postgres", ok: true };
    } catch (error) {
      return { name: "postgres", ok: false, error: toMessage(error) };
    }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    try {
      await this.redis.ping();
      return { name: "redis", ok: true };
    } catch (error) {
      return { name: "redis", ok: false, error: toMessage(error) };
    }
  }

  private async checkS3(): Promise<DependencyCheck> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }));
      return { name: "s3", ok: true };
    } catch (error) {
      return { name: "s3", ok: false, error: toMessage(error) };
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
