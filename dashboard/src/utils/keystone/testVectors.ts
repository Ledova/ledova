export const REQUEST_ID = '123e4567-e89b-12d3-a456-426614174000';
export const MESSAGE = 'Hardware wallet compatibility fixture';
export const FINGERPRINT = 'a1b2c3d4';
export const ORIGIN = 'TestApp';
export const ETH_PATH = "m/44'/60'/0'/0/0";
export const ETH_CHAIN_ID = 84532;
export const ETH_ADDRESS = '0x1111111111111111111111111111111111111111';
export const BTC_PATH = "m/84'/1'/0'/0/0";
export const TESTNET_BTC_ADDRESS = `tb1q${'a'.repeat(38)}`;

export const ETH_REQUEST_CBOR =
  'a701d82550123e4567e89b12d3a45642661417400002582548617264776172652077616c6c657420636f6d7061746962696c69747920666978747572650303041a00014a3405d90130a2018a182cf5183cf500f500f400f4021aa1b2c3d406541111111111111111111111111111111111111111076754657374417070';
export const ETH_REQUEST_UR =
  'ur:eth-sign-request/osadtpdagdbgfmfeiovsndbgteoxhffwiybbchfzaeaohddafdhsjpiekthsjpihcxkthsjzjzihjycxiajljnjohsjyinidinjzinjykkcxiyinksjykpjpihaxaxaacyaeadgeeeahtaaddyoeadlecsdwykcsfnykaeykaewkaewkaocyoyprsrtyamghbybybybybybybybybybybybybybybybybybybybyatioghihjkjyfpjojosroyleps';
export const BTC_REQUEST_CBOR =
  'a601d82550123e4567e89b12d3a45642661417400002582548617264776172652077616c6c657420636f6d7061746962696c697479206669787475726503010481d90130a2018a1854f501f500f500f400f4021aa1b2c3d40581782a746231716161616161616161616161616161616161616161616161616161616161616161616161616161066754657374417070';
export const BTC_REQUEST_UR =
  'ur:btc-sign-request/oladtpdagdbgfmfeiovsndbgteoxhffwiybbchfzaeaohddafdhsjpiekthsjpihcxkthsjzjzihjycxiajljnjohsjyinidinjzinjykkcxiyinksjykpjpihaxadaalytaaddyoeadlecsghykadykaeykaewkaewkaocyoyprsrtyahlyksdrjyidehjshshshshshshshshshshshshshshshshshshshshshshshshshshshshshshshshshshshshshshsamioghihjkjyfpjojoecrycfjp';

export const ETH_SIGNATURE_UR =
  'ur:eth-signature/otadtpdagdbgfmfeiovsndbgteoxhffwiybbchfzaeaohdfpbybybybybybybybybybybybybybybybybybybybybybybybybybybybybybybybycpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcwaxisgrihkkjkjyjljtihjtgeiaae';
export const ETH_SIGNATURE = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`;
export const BTC_SIGNATURE_UR =
  'ur:btc-signature/otadtpdagdbgfmfeiovsndbgteoxhffwiybbchfzaeaohdfpcteoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoeoaxhdclaofyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfyfycntnutao';
export const BTC_SIGNATURE = btoa(String.fromCharCode(0x1f, ...new Array<number>(64).fill(0x33)));

export const HARDHAT_ACCOUNT_EXPORT_UR =
  'ur:crypto-multi-accounts/otadcycmptfmtiaolytaaddlotaxhdclaoamrocwpslnbshtjyfwpdhfieteeslanlgoqdpsnyhglfcxaemdbgknstlepyjsykaahdcxcphdchnyyktosklkvdmuzonbjnfmyapsiebtfdcsaovtplessosffhskpdtocsbgamtaaddyotadlncsdwykcsfnykaeykaocycmptfmtiaxaxaxisgrihkkjkjyjljtihlasrisur';
export const HARDHAT_MASTER_FINGERPRINT = '16a93ed0';
export const HARDHAT_ACCOUNT_0 = {
  address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  addressIndex: 0,
  derivationPath: "m/44'/60'/0'/0/0",
  networkType: 'ETH',
};
