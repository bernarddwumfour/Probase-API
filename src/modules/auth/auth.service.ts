import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { MailService } from './services/mail.service';
import { OtpService } from './services/otp.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

// Bump when the Terms of Service text changes
const TERMS_VERSION = '2026-10-24';

export const profileInclude = {
    customerProfile: { select: { onboardedAt: true } },
    professionalProfile: { select: { onboardedAt: true } },
} satisfies Prisma.UserInclude;

export type UserWithProfiles = Prisma.UserGetPayload<{
    include: typeof profileInclude;
}>;

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly passwords: PasswordService,
        private readonly tokens: TokenService,
        private readonly otp: OtpService,
        private readonly mail: MailService,
    ) { }

    // ---------- D1: signup ----------

    async signup(dto: SignupDto) {
        const existing = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (existing) {
            if (existing.emailVerifiedAt) throw this.emailTaken();
            // Unverified: leave their data alone and just send a fresh code
            await this.sendVerification(existing);
            return this.signupResponse(existing.email);
        }

        const passwordHash = await this.passwords.hash(dto.password);
        let user;
        try {
            user = await this.prisma.user.create({
                data: {
                    fullName: dto.fullName,
                    email: dto.email,
                    passwordHash,
                    termsAcceptedAt: new Date(),
                    termsVersion: TERMS_VERSION,
                },
            });
        } catch (err) {
            // Two simultaneous signups with the same email: the DB index decides
            if (
                err instanceof Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002'
            ) {
                throw this.emailTaken();
            }
            throw err;
        }

        await this.sendVerification(user);
        return this.signupResponse(user.email);
    }

    // ---------- D2: verify and resend ----------

    async verifyOtp(dto: VerifyOtpDto, deviceInfo?: string) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        // Unknown email and already-verified look the same as a wrong code
        if (!user || user.emailVerifiedAt) {
            throw new AppException(400, ErrorCode.OTP_INVALID, 'The code is incorrect');
        }

        await this.otp.verify(user.id, 'email_verify', dto.code);

        if (user.status === 'suspended') {
            throw new AppException(403, ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended');
        }

        const verified = await this.prisma.user.update({
            where: { id: user.id },
            data: { emailVerifiedAt: new Date(), lastLoginAt: new Date() },
            include: profileInclude,
        });
        return this.createAuthResponse(verified, deviceInfo);
    }

    async resendOtp(dto: ResendOtpDto) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (user && !user.emailVerifiedAt && user.status === 'active') {
            await this.sendVerification(user);
        }
        // Same answer whether or not the account exists
        return { message: 'If an unverified account exists, a new code has been sent' };
    }

    // ---------- shared with D3 (login) and D4 (refresh) ----------

    /** Creates a new login session (new refresh-token family) and the response body. */
    async createAuthResponse(user: UserWithProfiles, deviceInfo?: string) {
        const refreshToken = this.tokens.generateRefreshToken();
        await this.prisma.refreshSession.create({
            data: {
                userId: user.id,
                familyId: this.tokens.newFamilyId(),
                tokenHash: this.tokens.hashToken(refreshToken),
                deviceInfo: deviceInfo?.slice(0, 255),
                expiresAt: this.tokens.refreshExpiry(),
            },
        });
        const accessToken = await this.tokens.signAccessToken(user);

        return {
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone,
                avatarUrl: user.avatarUrl,
                language: user.language,
                emailVerified: user.emailVerifiedAt !== null,
            },
            activeRole: user.activeRole,
            onboarded: {
                customer: !!user.customerProfile?.onboardedAt,
                professional: !!user.professionalProfile?.onboardedAt,
            },
        };
    }

    async login(dto: LoginDto, deviceInfo?: string) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
            include: profileInclude,
        });

        if (!user || user.deletedAt || !user.passwordHash) {
            await this.passwords.verifyDummy(dto.password);
            throw this.invalidCredentials();
        }
        if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
            throw this.invalidCredentials();
        }

        if (user.status === 'suspended') {
            throw new AppException(403, ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended');
        }
        if (!user.emailVerifiedAt) {
            await this.sendVerification(user);
            throw new AppException(
                403,
                ErrorCode.EMAIL_NOT_VERIFIED,
                'Verify your email to continue',
                { email: user.email },
            );
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });
        return this.createAuthResponse(user, deviceInfo);
    }

    // ---------- D4: refresh and logout ----------

    async refresh(dto: RefreshDto, deviceInfo?: string) {
        const tokenHash = this.tokens.hashToken(dto.refreshToken);
        const session = await this.prisma.refreshSession.findUnique({
            where: { tokenHash },
        });

        if (!session || session.revokedAt || session.expiresAt <= new Date()) {
            throw this.refreshInvalid();
        }
        if (session.rotatedAt) throw await this.reuseDetected(session);

        const user = await this.prisma.user.findUnique({
            where: { id: session.userId },
            include: profileInclude,
        });
        if (!user || user.deletedAt || user.status !== 'active') {
            await this.revokeFamily(session.familyId);
            throw this.refreshInvalid();
        }

        const newToken = this.tokens.generateRefreshToken();
        try {
            await this.prisma.$transaction(async (tx) => {
                // Atomic: only one request can rotate this token
                const { count } = await tx.refreshSession.updateMany({
                    where: { id: session.id, rotatedAt: null, revokedAt: null },
                    data: { rotatedAt: new Date() },
                });
                if (count !== 1) throw new Error('ROTATION_RACE');
                await tx.refreshSession.create({
                    data: {
                        userId: user.id,
                        familyId: session.familyId,
                        tokenHash: this.tokens.hashToken(newToken),
                        deviceInfo: (deviceInfo ?? session.deviceInfo)?.slice(0, 255),
                        expiresAt: this.tokens.refreshExpiry(),
                    },
                });
            });
        } catch (err) {
            if (err instanceof Error && err.message === 'ROTATION_RACE') {
                throw await this.reuseDetected(session);
            }
            throw err;
        }

        return {
            accessToken: await this.tokens.signAccessToken(user),
            refreshToken: newToken,
            activeRole: user.activeRole,
            onboarded: {
                customer: !!user.customerProfile?.onboardedAt,
                professional: !!user.professionalProfile?.onboardedAt,
            },
        };
    }

    /** Ends this device's login. Always succeeds, so it reveals nothing. */
    async logout(dto: RefreshDto) {
        const session = await this.prisma.refreshSession.findUnique({
            where: { tokenHash: this.tokens.hashToken(dto.refreshToken) },
        });
        if (session) await this.revokeFamily(session.familyId);
    }

    // ---------- D5: forgot and reset password ----------

    async forgotPassword(dto: ForgotPasswordDto) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (user && !user.deletedAt && user.status === 'active') {
            try {
                const code = await this.otp.issue(user.id, 'password_reset');
                await this.mail.sendPasswordResetCode(user.email, user.fullName, code);
            } catch (err) {
                const tooSoon =
                    err instanceof AppException && err.code === ErrorCode.OTP_RESEND_TOO_SOON;
                if (!tooSoon) {
                    this.logger.error({ err, userId: user.id }, 'Failed to send reset code');
                }
            }
        }
        // Identical response whether or not the account exists
        return { message: 'If an account exists for this email, a reset code has been sent' };
    }

    async resetPassword(dto: ResetPasswordDto) {
        const invalid = () =>
            new AppException(
                400,
                ErrorCode.RESET_CODE_INVALID,
                'The code is invalid or has expired',
            );

        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (!user || user.deletedAt || user.status !== 'active') throw invalid();

        try {
            await this.otp.verify(user.id, 'password_reset', dto.code);
        } catch (err) {
            if (err instanceof AppException) throw invalid();
            throw err;
        }

        const passwordHash = await this.passwords.hash(dto.newPassword);
        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: user.id },
                data: {
                    passwordHash,
                    // A valid emailed code proves they own this inbox
                    emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
                },
            }),
            this.prisma.refreshSession.updateMany({
                where: { userId: user.id, revokedAt: null },
                data: { revokedAt: new Date() },
            }),
        ]);
    }

    // ---------- D6: change password ----------

    async changePassword(userId: string, dto: ChangePasswordDto, deviceInfo?: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: profileInclude,
        });
        if (!user || user.deletedAt || user.status !== 'active') {
            throw new AppException(401, ErrorCode.UNAUTHORIZED, 'Invalid access token');
        }
        if (!user.passwordHash) {
            throw new AppException(
                422,
                ErrorCode.PASSWORD_NOT_SET,
                'This account has no password yet. Use "Forgot password" to set one',
            );
        }
        if (!(await this.passwords.verify(user.passwordHash, dto.oldPassword))) {
            throw new AppException(
                400,
                ErrorCode.OLD_PASSWORD_INCORRECT,
                'Your current password is incorrect',
            );
        }
        if (dto.oldPassword === dto.newPassword) {
            throw new AppException(
                400,
                ErrorCode.PASSWORD_UNCHANGED,
                'The new password must be different from the old one',
            );
        }

        const passwordHash = await this.passwords.hash(dto.newPassword);
        await this.prisma.$transaction([
            this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
            this.prisma.refreshSession.updateMany({
                where: { userId: user.id, revokedAt: null },
                data: { revokedAt: new Date() },
            }),
        ]);

        // Every device is signed out; this one gets a fresh session
        return this.createAuthResponse(user, deviceInfo);
    }

    private async revokeFamily(familyId: string) {
        await this.prisma.refreshSession.updateMany({
            where: { familyId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }

    private async reuseDetected(session: { id: string; userId: string; familyId: string }) {
        this.logger.warn(
            { userId: session.userId, familyId: session.familyId },
            'Refresh token reuse detected; revoking session family',
        );
        await this.revokeFamily(session.familyId);
        return new AppException(
            401,
            ErrorCode.REFRESH_REUSED,
            'Session is no longer valid. Please log in again',
        );
    }

    private invalidCredentials() {
        return new AppException(401, ErrorCode.INVALID_CREDENTIALS, 'Incorrect email or password');
    }

    private refreshInvalid() {
        return new AppException(401, ErrorCode.REFRESH_INVALID, 'Invalid or expired session');
    }

    // ---------- helpers ----------

    private async sendVerification(user: { id: string; email: string; fullName: string }) {
        try {
            const code = await this.otp.issue(user.id, 'email_verify');
            await this.mail.sendVerificationCode(user.email, user.fullName, code);
        } catch (err) {
            // Cooldown: a code was sent moments ago, nothing more to do
            if (err instanceof AppException && err.code === ErrorCode.OTP_RESEND_TOO_SOON) {
                return;
            }
            // Don't fail signup because email failed; the user can tap "resend"
            this.logger.error({ err, userId: user.id }, 'Failed to send verification code');
        }
    }

    private signupResponse(email: string) {
        return { email, verificationRequired: true };
    }

    private emailTaken() {
        return new AppException(
            409,
            ErrorCode.EMAIL_TAKEN,
            'An account with this email already exists',
        );
    }
}