// Pons v2 ABIs (Robinhood Chain). Generated from the verified ABI JSON published in
// github.com/ponsrdotfun/ponsr (backend/src/abi/ponsV2CurrentLaunchFactory.json and
// ponsV2CurrentBondingCurveAbi.json), filtered to what mapin calls. Custom errors are kept
// in full so reverts decode to readable names. Do not edit by hand.

export const ponsFactoryAbi = [
 {
  "type": "error",
  "name": "AlreadySet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CombinedFeeTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CoreLpFeeMustBeZero",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CreatorTaxTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CurveFeeTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CurveNotQuotable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ExemptionListTooLong",
  "inputs": []
 },
 {
  "type": "error",
  "name": "FeeTransferFailed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "GraduationExecutorNotSet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "GraduationRescueTooEarly",
  "inputs": [
   {
    "name": "availableAt",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "GraduationSeedNotViable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "GraduationStillViable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InexactTransfer",
  "inputs": [
   {
    "name": "token",
    "type": "address"
   },
   {
    "name": "expected",
    "type": "uint256"
   },
   {
    "name": "received",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "InvalidBasisPoints",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidGraduationThreshold",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidLaunchConfigId",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidPhantomQuote",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidSnipeTaxWindow",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidTickSpacing",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidTokenParams",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchConfigDisabled",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchDependenciesNotWired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchDeployerNotSet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchEconomicsMismatch",
  "inputs": [
   {
    "name": "expected",
    "type": "bytes32"
   },
   {
    "name": "actual",
    "type": "bytes32"
   }
  ]
 },
 {
  "type": "error",
  "name": "LaunchFeeNotPaid",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoPendingChange",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotBuybackController",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotCreatorFeeRecipient",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotLaunchForwarder",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotReadyToGraduate",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotWhitelisted",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NothingToGraduate",
  "inputs": []
 },
 {
  "type": "error",
  "name": "OwnableInvalidOwner",
  "inputs": [
   {
    "name": "owner",
    "type": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "OwnableUnauthorizedAccount",
  "inputs": [
   {
    "name": "account",
    "type": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "OwnershipCannotBeRenounced",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PairTokenDecimalsMismatch",
  "inputs": [
   {
    "name": "expected",
    "type": "uint8"
   },
   {
    "name": "actual",
    "type": "uint8"
   }
  ]
 },
 {
  "type": "error",
  "name": "PairTokenDecimalsUnavailable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PairTokenEconomicsInvalid",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PairTokenNotApproved",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PairTokenValidationFailed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ReentrancyGuardReentrantCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SafeERC20FailedOperation",
  "inputs": [
   {
    "name": "token",
    "type": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "SqrtPriceOutOfBounds",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SupplyTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SupplyTooLow",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TimelockExpired",
  "inputs": [
   {
    "name": "expiresAt",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "TimelockNotElapsed",
  "inputs": [
   {
    "name": "effectiveAt",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "TokenNotFound",
  "inputs": []
 },
 {
  "type": "error",
  "name": "UnsupportedPrice",
  "inputs": []
 },
 {
  "type": "error",
  "name": "WrongGraduationPhase",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ZeroAddress",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ZeroAmount",
  "inputs": []
 },
 {
  "type": "event",
  "name": "LaunchSwept",
  "anonymous": false,
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true
   },
   {
    "name": "quoteOut",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "tokenOut",
    "type": "uint256",
    "indexed": false
   }
  ]
 },
 {
  "type": "event",
  "name": "PoolGraduated",
  "anonymous": false,
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true
   },
   {
    "name": "positionId",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "tokenAmount",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "pairTokenAmount",
    "type": "uint256",
    "indexed": false
   }
  ]
 },
 {
  "type": "event",
  "name": "TokenLaunched",
  "anonymous": false,
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true
   },
   {
    "name": "curve",
    "type": "address",
    "indexed": true
   },
   {
    "name": "deployer",
    "type": "address",
    "indexed": true
   },
   {
    "name": "pairToken",
    "type": "address",
    "indexed": false
   },
   {
    "name": "launchConfigId",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "graduationThreshold",
    "type": "uint256",
    "indexed": false
   }
  ]
 },
 {
  "type": "function",
  "name": "approvedPairTokens",
  "stateMutability": "view",
  "inputs": [
   {
    "name": "pairToken",
    "type": "address"
   }
  ],
  "outputs": [
   {
    "name": "approved",
    "type": "bool"
   }
  ]
 },
 {
  "type": "function",
  "name": "canLaunch",
  "stateMutability": "view",
  "inputs": [
   {
    "name": "launcher",
    "type": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bool"
   }
  ]
 },
 {
  "type": "function",
  "name": "createGraduatedPool",
  "stateMutability": "nonpayable",
  "inputs": [
   {
    "name": "token",
    "type": "address"
   }
  ],
  "outputs": [
   {
    "name": "positionId",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "getLaunchConfig",
  "stateMutability": "view",
  "inputs": [
   {
    "name": "id",
    "type": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "components": [
     {
      "name": "supply",
      "type": "uint256"
     },
     {
      "name": "curveFeeBps",
      "type": "uint256"
     },
     {
      "name": "phantomQuote",
      "type": "uint256"
     },
     {
      "name": "graduationThreshold",
      "type": "uint256"
     },
     {
      "name": "poolFee",
      "type": "uint24"
     },
     {
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "name": "enabled",
      "type": "bool"
     }
    ]
   }
  ]
 },
 {
  "type": "function",
  "name": "getLaunchedToken",
  "stateMutability": "view",
  "inputs": [
   {
    "name": "token",
    "type": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "components": [
     {
      "name": "token",
      "type": "address"
     },
     {
      "name": "curve",
      "type": "address"
     },
     {
      "name": "deployer",
      "type": "address"
     },
     {
      "name": "creatorFeeRecipient",
      "type": "address"
     },
     {
      "name": "pairToken",
      "type": "address"
     },
     {
      "name": "graduationThreshold",
      "type": "uint256"
     },
     {
      "name": "poolFee",
      "type": "uint24"
     },
     {
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "name": "creatorTaxBps",
      "type": "uint16"
     },
     {
      "name": "buybackEnabled",
      "type": "bool"
     },
     {
      "name": "phase",
      "type": "uint8"
     },
     {
      "name": "sweptQuote",
      "type": "uint256"
     },
     {
      "name": "sweptTokens",
      "type": "uint256"
     },
     {
      "name": "sweptAt",
      "type": "uint256"
     },
     {
      "name": "exists",
      "type": "bool"
     }
    ]
   }
  ]
 },
 {
  "type": "function",
  "name": "graduate",
  "stateMutability": "nonpayable",
  "inputs": [
   {
    "name": "token",
    "type": "address"
   }
  ],
  "outputs": []
 },
 {
  "type": "function",
  "name": "launchConfigCount",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "launchEnabled",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bool"
   }
  ]
 },
 {
  "type": "function",
  "name": "launchFee",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "launchForwarder",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address"
   }
  ]
 },
 {
  "type": "function",
  "name": "launchToken",
  "stateMutability": "payable",
  "inputs": [
   {
    "name": "params",
    "type": "tuple",
    "components": [
     {
      "name": "name",
      "type": "string"
     },
     {
      "name": "symbol",
      "type": "string"
     },
     {
      "name": "logo",
      "type": "string"
     },
     {
      "name": "description",
      "type": "string"
     },
     {
      "name": "socials",
      "type": "tuple",
      "components": [
       {
        "name": "twitter",
        "type": "string"
       },
       {
        "name": "telegram",
        "type": "string"
       },
       {
        "name": "discord",
        "type": "string"
       },
       {
        "name": "website",
        "type": "string"
       },
       {
        "name": "farcaster",
        "type": "string"
       }
      ]
     },
     {
      "name": "creatorFeeRecipient",
      "type": "address"
     },
     {
      "name": "creatorTaxBps",
      "type": "uint16"
     },
     {
      "name": "buybackEnabled",
      "type": "bool"
     },
     {
      "name": "expectedEconomics",
      "type": "bytes32"
     },
     {
      "name": "salt",
      "type": "bytes32"
     }
    ]
   },
   {
    "name": "launchConfigId",
    "type": "uint256"
   },
   {
    "name": "pairToken",
    "type": "address"
   },
   {
    "name": "snipeTaxExemptions",
    "type": "address[]"
   }
  ],
  "outputs": [
   {
    "name": "token",
    "type": "address"
   },
   {
    "name": "curve",
    "type": "address"
   }
  ]
 },
 {
  "type": "function",
  "name": "launchToken",
  "stateMutability": "payable",
  "inputs": [
   {
    "name": "params",
    "type": "tuple",
    "components": [
     {
      "name": "name",
      "type": "string"
     },
     {
      "name": "symbol",
      "type": "string"
     },
     {
      "name": "logo",
      "type": "string"
     },
     {
      "name": "description",
      "type": "string"
     },
     {
      "name": "socials",
      "type": "tuple",
      "components": [
       {
        "name": "twitter",
        "type": "string"
       },
       {
        "name": "telegram",
        "type": "string"
       },
       {
        "name": "discord",
        "type": "string"
       },
       {
        "name": "website",
        "type": "string"
       },
       {
        "name": "farcaster",
        "type": "string"
       }
      ]
     },
     {
      "name": "creatorFeeRecipient",
      "type": "address"
     },
     {
      "name": "creatorTaxBps",
      "type": "uint16"
     },
     {
      "name": "buybackEnabled",
      "type": "bool"
     },
     {
      "name": "expectedEconomics",
      "type": "bytes32"
     },
     {
      "name": "salt",
      "type": "bytes32"
     }
    ]
   },
   {
    "name": "launchConfigId",
    "type": "uint256"
   },
   {
    "name": "pairToken",
    "type": "address"
   }
  ],
  "outputs": [
   {
    "name": "token",
    "type": "address"
   },
   {
    "name": "curve",
    "type": "address"
   }
  ]
 },
 {
  "type": "function",
  "name": "maxCreatorTaxBps",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "memeHook",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address"
   }
  ]
 },
 {
  "type": "function",
  "name": "pairTokenEconomics",
  "stateMutability": "view",
  "inputs": [
   {
    "name": "pairToken",
    "type": "address"
   }
  ],
  "outputs": [
   {
    "name": "phantomQuote",
    "type": "uint256"
   },
   {
    "name": "graduationThreshold",
    "type": "uint256"
   },
   {
    "name": "decimals",
    "type": "uint8"
   }
  ]
 },
 {
  "type": "function",
  "name": "previewLaunchEconomics",
  "stateMutability": "view",
  "inputs": [
   {
    "name": "launchConfigId",
    "type": "uint256"
   },
   {
    "name": "pairToken",
    "type": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bytes32"
   }
  ]
 }
] as const;

export const ponsCurveAbi = [
 {
  "type": "error",
  "name": "AlreadyGraduated",
  "inputs": []
 },
 {
  "type": "error",
  "name": "AlreadyInitialized",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CurveGraduated",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InsufficientInputAmount",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InsufficientLiquidity",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InsufficientOutputAmount",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InternalSwapRequiresOperator",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidFeePolicy",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidLaunchEconomics",
  "inputs": []
 },
 {
  "type": "error",
  "name": "MinimumOutputRequired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NativeValueMismatch",
  "inputs": [
   {
    "name": "supplied",
    "type": "uint256"
   },
   {
    "name": "expected",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "NotFactory",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotFeeSweepOperator",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotInitialized",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotReadyToGraduate",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ReentrancyGuardReentrantCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SafeERC20FailedOperation",
  "inputs": [
   {
    "name": "token",
    "type": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "SlippageExceeded",
  "inputs": [
   {
    "name": "actual",
    "type": "uint256"
   },
   {
    "name": "minimum",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "TransferFailed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "UnexpectedNativeValue",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ZeroAddress",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ZeroAmount",
  "inputs": []
 },
 {
  "type": "event",
  "name": "CurveBuy",
  "anonymous": false,
  "inputs": [
   {
    "name": "buyer",
    "type": "address",
    "indexed": true
   },
   {
    "name": "recipient",
    "type": "address",
    "indexed": true
   },
   {
    "name": "quoteIn",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "tokensOut",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "fee",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "tax",
    "type": "uint256",
    "indexed": false
   }
  ]
 },
 {
  "type": "event",
  "name": "CurveBuyRefunded",
  "anonymous": false,
  "inputs": [
   {
    "name": "buyer",
    "type": "address",
    "indexed": true
   },
   {
    "name": "refund",
    "type": "uint256",
    "indexed": false
   }
  ]
 },
 {
  "type": "event",
  "name": "CurveCompleted",
  "anonymous": false,
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "indexed": false
   },
   {
    "name": "quoteOut",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "tokenOut",
    "type": "uint256",
    "indexed": false
   }
  ]
 },
 {
  "type": "event",
  "name": "CurveSell",
  "anonymous": false,
  "inputs": [
   {
    "name": "seller",
    "type": "address",
    "indexed": true
   },
   {
    "name": "recipient",
    "type": "address",
    "indexed": true
   },
   {
    "name": "tokensIn",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "quoteOut",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "fee",
    "type": "uint256",
    "indexed": false
   },
   {
    "name": "tax",
    "type": "uint256",
    "indexed": false
   }
  ]
 },
 {
  "type": "function",
  "name": "buy",
  "stateMutability": "payable",
  "inputs": [
   {
    "name": "quoteIn",
    "type": "uint256"
   },
   {
    "name": "minTokensOut",
    "type": "uint256"
   },
   {
    "name": "recipient",
    "type": "address"
   }
  ],
  "outputs": [
   {
    "name": "tokensOut",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "creatorTaxBps",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "deployer",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address"
   }
  ]
 },
 {
  "type": "function",
  "name": "feeBps",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "getReserves",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "quoteReserve_",
    "type": "uint256"
   },
   {
    "name": "tokenReserve_",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "graduated",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bool"
   }
  ]
 },
 {
  "type": "function",
  "name": "graduationThreshold",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "isNativeQuote",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bool"
   }
  ]
 },
 {
  "type": "function",
  "name": "pairToken",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address"
   }
  ]
 },
 {
  "type": "function",
  "name": "phantomQuote",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "quoteReserve",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "quoteReserve_",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "readyToGraduate",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bool"
   }
  ]
 },
 {
  "type": "function",
  "name": "realQuoteReserve",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "reservedTokens",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "sell",
  "stateMutability": "nonpayable",
  "inputs": [
   {
    "name": "tokensIn",
    "type": "uint256"
   },
   {
    "name": "minQuoteOut",
    "type": "uint256"
   },
   {
    "name": "recipient",
    "type": "address"
   }
  ],
  "outputs": [
   {
    "name": "quoteOut",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "sellableTokens",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "token",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address"
   }
  ]
 },
 {
  "type": "function",
  "name": "tokenReserve",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "tokenReserve_",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "trackedQuote",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "function",
  "name": "trackedTokens",
  "stateMutability": "view",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256"
   }
  ]
 }
] as const;

/** Every Pons factory + curve custom error, for decoding reverts that bubble through the launch router. */
export const ponsErrorsAbi = [
 {
  "type": "error",
  "name": "AlreadySet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CombinedFeeTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CoreLpFeeMustBeZero",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CreatorTaxTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CurveFeeTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CurveNotQuotable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ExemptionListTooLong",
  "inputs": []
 },
 {
  "type": "error",
  "name": "FeeTransferFailed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "GraduationExecutorNotSet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "GraduationRescueTooEarly",
  "inputs": [
   {
    "name": "availableAt",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "GraduationSeedNotViable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "GraduationStillViable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InexactTransfer",
  "inputs": [
   {
    "name": "token",
    "type": "address"
   },
   {
    "name": "expected",
    "type": "uint256"
   },
   {
    "name": "received",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "InvalidBasisPoints",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidGraduationThreshold",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidLaunchConfigId",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidPhantomQuote",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidSnipeTaxWindow",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidTickSpacing",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidTokenParams",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchConfigDisabled",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchDependenciesNotWired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchDeployerNotSet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchEconomicsMismatch",
  "inputs": [
   {
    "name": "expected",
    "type": "bytes32"
   },
   {
    "name": "actual",
    "type": "bytes32"
   }
  ]
 },
 {
  "type": "error",
  "name": "LaunchFeeNotPaid",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoPendingChange",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotBuybackController",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotCreatorFeeRecipient",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotLaunchForwarder",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotReadyToGraduate",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotWhitelisted",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NothingToGraduate",
  "inputs": []
 },
 {
  "type": "error",
  "name": "OwnableInvalidOwner",
  "inputs": [
   {
    "name": "owner",
    "type": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "OwnableUnauthorizedAccount",
  "inputs": [
   {
    "name": "account",
    "type": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "OwnershipCannotBeRenounced",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PairTokenDecimalsMismatch",
  "inputs": [
   {
    "name": "expected",
    "type": "uint8"
   },
   {
    "name": "actual",
    "type": "uint8"
   }
  ]
 },
 {
  "type": "error",
  "name": "PairTokenDecimalsUnavailable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PairTokenEconomicsInvalid",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PairTokenNotApproved",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PairTokenValidationFailed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ReentrancyGuardReentrantCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SafeERC20FailedOperation",
  "inputs": [
   {
    "name": "token",
    "type": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "SqrtPriceOutOfBounds",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SupplyTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SupplyTooLow",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TimelockExpired",
  "inputs": [
   {
    "name": "expiresAt",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "TimelockNotElapsed",
  "inputs": [
   {
    "name": "effectiveAt",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "TokenNotFound",
  "inputs": []
 },
 {
  "type": "error",
  "name": "UnsupportedPrice",
  "inputs": []
 },
 {
  "type": "error",
  "name": "WrongGraduationPhase",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ZeroAddress",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ZeroAmount",
  "inputs": []
 },
 {
  "type": "error",
  "name": "AlreadyGraduated",
  "inputs": []
 },
 {
  "type": "error",
  "name": "AlreadyInitialized",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CurveGraduated",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InsufficientInputAmount",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InsufficientLiquidity",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InsufficientOutputAmount",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InternalSwapRequiresOperator",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidFeePolicy",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidLaunchEconomics",
  "inputs": []
 },
 {
  "type": "error",
  "name": "MinimumOutputRequired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NativeValueMismatch",
  "inputs": [
   {
    "name": "supplied",
    "type": "uint256"
   },
   {
    "name": "expected",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "NotFactory",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotFeeSweepOperator",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotInitialized",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SlippageExceeded",
  "inputs": [
   {
    "name": "actual",
    "type": "uint256"
   },
   {
    "name": "minimum",
    "type": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "TransferFailed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "UnexpectedNativeValue",
  "inputs": []
 }
] as const;
