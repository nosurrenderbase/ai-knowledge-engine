import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {graphqlOperations, restRoutes} from '../src/endpoints.ts';

describe('graphqlOperations', () => {
  it('uses the method name, or the name option when given', () => {
    const src = `
@Resolver()
export class R {
  @Query(() => [Referral], {nullable: true})
  @UseGuards(GqlJwtAuthGuard)
  async myReferrals(@CurrentUser() user: User) {}

  @Mutation(() => Boolean, {name: 'applyReferralCode', description: 'kod (davet)'})
  apply() {}

  @Subscription(() => Match, {
    filter: (p, v) => p.id === v.id,
  })
  matchUpdated() {}
}`;
    assert.deepEqual(graphqlOperations(src), ['myReferrals', 'applyReferralCode', 'matchUpdated']);
  });

  it('is not fooled by parentheses inside strings', () => {
    const src = "@Query(() => String, {description: 'a) b'})\nserverTime() {}";
    assert.deepEqual(graphqlOperations(src), ['serverTime']);
  });

  it('returns nothing for files without operations', () => {
    assert.deepEqual(graphqlOperations('export class X {}'), []);
  });
});

describe('restRoutes', () => {
  it('joins the controller prefix and method paths', () => {
    const src = `
@Controller('internal/kyc')
export class C {
  @Post('process-verified')
  a() {}
  @Post('/unlock/:userId')
  b() {}
  @Get()
  c() {}
}`;
    assert.deepEqual(restRoutes(src), ['/internal/kyc/process-verified', '/internal/kyc/unlock/:userId', '/internal/kyc']);
  });

  it('supports object-style controller options and controllers without a prefix', () => {
    assert.deepEqual(restRoutes("@Controller({path: 'webhooks/revenuecat'})\nclass C {\n@Post()\nx() {}\n}"), ['/webhooks/revenuecat']);
    assert.deepEqual(restRoutes('@Controller()\nclass C {\n@Get(\'health\')\nh() {}\n}'), ['/health']);
  });
});
