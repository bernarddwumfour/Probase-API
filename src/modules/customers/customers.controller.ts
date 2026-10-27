import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CustomersService } from './customers.service';
import { OnboardCustomerDto } from './dto/onboard-customer.dto';

@ApiTags('customer')
@ApiBearerAuth()
@Controller('me/customer-profile')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  onboard(@CurrentUser('id') userId: string, @Body() dto: OnboardCustomerDto) {
    return this.customers.onboard(userId, dto);
  }
}