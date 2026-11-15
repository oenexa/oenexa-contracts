// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IERC20Token {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title OenexaLiquidityPool
 * @notice Constant-Product Automated Market Maker (x * y = k) for ONXC pairs.
 * Supports minting/burning LP tokens and token swaps with 0.3% protocol fee.
 */
contract OenexaLiquidityPool {
    IERC20Token public token0;
    IERC20Token public token1;

    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public totalLpSupply;

    mapping(address => uint256) public lpBalance;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(address indexed sender, uint256 amountIn, uint256 amountOut, address indexed to, bool zeroForOne);

    constructor(address _token0, address _token1) {
        token0 = IERC20Token(_token0);
        token1 = IERC20Token(_token1);
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidity) {
        require(token0.transferFrom(msg.sender, address(this), amount0), "AMM: Transfer0 failed");
        require(token1.transferFrom(msg.sender, address(this), amount1), "AMM: Transfer1 failed");

        if (totalLpSupply == 0) {
            liquidity = _sqrt(amount0 * amount1);
        } else {
            uint256 l0 = (amount0 * totalLpSupply) / reserve0;
            uint256 l1 = (amount1 * totalLpSupply) / reserve1;
            liquidity = l0 < l1 ? l0 : l1;
        }

        require(liquidity > 0, "AMM: Insufficient liquidity minted");
        lpBalance[msg.sender] += liquidity;
        totalLpSupply += liquidity;

        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));

        emit Mint(msg.sender, amount0, amount1, liquidity);
    }

    function swap(uint256 amountIn, bool zeroForOne, address to) external returns (uint256 amountOut) {
        require(amountIn > 0, "AMM: Insufficient input");

        (IERC20Token tokenIn, IERC20Token tokenOut, uint256 resIn, uint256 resOut) = zeroForOne
            ? (token0, token1, reserve0, reserve1)
            : (token1, token0, reserve1, reserve0);

        require(tokenIn.transferFrom(msg.sender, address(this), amountIn), "AMM: TransferIn failed");

        // 0.3% fee: amountInWithFee = amountIn * 997 / 1000
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * resOut;
        uint256 denominator = (resIn * 1000) + amountInWithFee;
        amountOut = numerator / denominator;

        require(amountOut > 0 && amountOut < resOut, "AMM: Invalid output");
        require(tokenOut.transfer(to, amountOut), "AMM: TransferOut failed");

        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));

        emit Swap(msg.sender, amountIn, amountOut, to, zeroForOne);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
