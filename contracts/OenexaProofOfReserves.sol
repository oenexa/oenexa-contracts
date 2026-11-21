// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OenexaProofOfReserves
 * @notice On-chain immutable registry for OENEXA Cryptographic Proof of Reserves (PoR).
 * Periodically records Merkle Roots of user liabilities alongside verified cold reserves.
 */
contract OenexaProofOfReserves {
    address public immutable owner;
    address public auditor;

    struct Attestation {
        uint256 epochId;
        bytes32 merkleRoot;
        uint256 totalLiabilitiesUSD;
        uint256 totalReservesUSD;
        uint256 reserveRatioBps; // Basis points: 10000 = 100%
        uint256 timestamp;
        bytes auditorSignature;
    }

    Attestation[] public attestations;
    mapping(uint256 => bool) public epochExists;

    event AttestationPublished(
        uint256 indexed epochId,
        bytes32 indexed merkleRoot,
        uint256 totalLiabilitiesUSD,
        uint256 totalReservesUSD,
        uint256 reserveRatioBps,
        uint256 timestamp
    );

    event AuditorUpdated(address indexed oldAuditor, address indexed newAuditor);

    modifier onlyOwner() {
        require(msg.sender == owner, "Unauthorized: Only owner");
        _;
    }

    modifier onlyAuditorOrOwner() {
        require(msg.sender == auditor || msg.sender == owner, "Unauthorized: Only auditor or owner");
        _;
    }

    constructor(address _auditor) {
        owner = msg.sender;
        auditor = _auditor;
    }

    function setAuditor(address _newAuditor) external onlyOwner {
        require(_newAuditor != address(0), "Invalid auditor address");
        emit AuditorUpdated(auditor, _newAuditor);
        auditor = _newAuditor;
    }

    function publishAttestation(
        uint256 epochId,
        bytes32 merkleRoot,
        uint256 totalLiabilitiesUSD,
        uint256 totalReservesUSD,
        bytes calldata auditorSignature
    ) external onlyAuditorOrOwner {
        require(!epochExists[epochId], "Epoch already recorded");
        require(totalLiabilitiesUSD > 0, "Liabilities must be > 0");
        require(totalReservesUSD >= totalLiabilitiesUSD, "Reserves must cover 100% of liabilities");

        uint256 ratioBps = (totalReservesUSD * 10000) / totalLiabilitiesUSD;

        Attestation memory newAttestation = Attestation({
            epochId: epochId,
            merkleRoot: merkleRoot,
            totalLiabilitiesUSD: totalLiabilitiesUSD,
            totalReservesUSD: totalReservesUSD,
            reserveRatioBps: ratioBps,
            timestamp: block.timestamp,
            auditorSignature: auditorSignature
        });

        attestations.push(newAttestation);
        epochExists[epochId] = true;

        emit AttestationPublished(
            epochId,
            merkleRoot,
            totalLiabilitiesUSD,
            totalReservesUSD,
            ratioBps,
            block.timestamp
        );
    }

    function getLatestAttestation() external view returns (Attestation memory) {
        require(attestations.length > 0, "No attestations recorded");
        return attestations[attestations.length - 1];
    }

    function getAttestationsCount() external view returns (uint256) {
        return attestations.length;
    }

    /**
     * @notice Verifies a user balance leaf against a published Merkle root
     */
    function verifyInclusion(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) external pure returns (bool) {
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == root;
    }
}
