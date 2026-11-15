// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title ONXCToken
 * @notice Native utility, governance and gas token for the OENEXA Layer 1 Ecosystem.
 * Implements ERC-20, ERC-2612 Permit, Burnable, and Post-Quantum Key Rotation Registry.
 */
contract ONXCToken {
    string public constant name = "OENEXA Native Coin";
    string public constant symbol = "ONXC";
    uint8 public constant decimals = 18;

    uint256 private _totalSupply;
    address public owner;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => uint256) public nonces;
    mapping(address => bytes32) public pqPublicKeys; // ML-DSA (Dilithium) public key root

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event PQKeyRegistered(address indexed account, bytes32 indexed pqKeyHash);
    event Burn(address indexed account, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "ONXC: Caller is not the owner");
        _;
    }

    constructor(uint256 initialSupply, address initialOwner) {
        require(initialOwner != address(0), "ONXC: Invalid initial owner");
        owner = initialOwner;
        _totalSupply = initialSupply;
        _balances[initialOwner] = initialSupply;
        emit Transfer(address(0), initialOwner, initialSupply);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address tokenOwner, address spender) external view returns (uint256) {
        return _allowances[tokenOwner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "ONXC: Insufficient allowance");
        unchecked {
            _approve(from, msg.sender, currentAllowance - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function burn(uint256 amount) external returns (bool) {
        require(_balances[msg.sender] >= amount, "ONXC: Insufficient balance to burn");
        unchecked {
            _balances[msg.sender] -= amount;
            _totalSupply -= amount;
        }
        emit Burn(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);
        return true;
    }

    function registerPQKey(bytes32 pqKeyHash) external {
        pqPublicKeys[msg.sender] = pqKeyHash;
        emit PQKeyRegistered(msg.sender, pqKeyHash);
    }

    function permit(
        address tokenOwner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "ONXC: Permit expired");
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, tokenOwner, spender, value, nonces[tokenOwner]++, deadline)
        );
        bytes32 hash = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0) && signer == tokenOwner, "ONXC: Invalid permit signature");
        _approve(tokenOwner, spender, value);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "ONXC: Transfer from zero address");
        require(to != address(0), "ONXC: Transfer to zero address");
        require(_balances[from] >= amount, "ONXC: Transfer amount exceeds balance");

        unchecked {
            _balances[from] -= amount;
            _balances[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _approve(address tokenOwner, address spender, uint256 amount) internal {
        require(tokenOwner != address(0), "ONXC: Approve from zero address");
        require(spender != address(0), "ONXC: Approve to zero address");
        _allowances[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }
}
