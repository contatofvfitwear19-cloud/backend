-- FV Fitwear — estrutura do banco (sem dados)
-- Este arquivo é só de referência para recriar a estrutura em outro ambiente.
-- O banco real de produção você já mantém no Hostinger (u643153119_fvfitwear).

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";
SET NAMES utf8mb4;

CREATE TABLE `Coupon` (
  `id` varchar(191) NOT NULL,
  `code` varchar(191) NOT NULL,
  `title` varchar(191) NOT NULL,
  `category` varchar(50) NOT NULL DEFAULT 'todos',
  `discountType` varchar(20) NOT NULL DEFAULT 'percentual',
  `value` double NOT NULL,
  `maxUses` int(11) DEFAULT NULL,
  `usesCount` int(11) NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `expiresAt` datetime DEFAULT NULL,
  `createdAt` datetime NOT NULL DEFAULT current_timestamp(),
  `updatedAt` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Order` (
  `id` varchar(191) NOT NULL,
  `address` varchar(191) NOT NULL,
  `paymentMethod` varchar(191) NOT NULL,
  `total` double NOT NULL,
  `status` varchar(191) NOT NULL DEFAULT 'Pendente',
  `customerName` varchar(255) NOT NULL DEFAULT '',
  `customerEmail` varchar(255) NOT NULL DEFAULT '',
  `region` varchar(50) DEFAULT 'tupi',
  `cep` varchar(10) DEFAULT '',
  `bairro` varchar(100) DEFAULT '',
  `cidade` varchar(100) DEFAULT '',
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `shippingFee` float NOT NULL DEFAULT 0,
  `subtotal` double NOT NULL DEFAULT 0,
  `couponCode` varchar(191) NOT NULL DEFAULT '',
  `couponDiscount` double NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `OrderItem` (
  `id` varchar(191) NOT NULL,
  `orderId` varchar(191) NOT NULL,
  `productId` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `price` double NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `size` varchar(191) NOT NULL,
  `color` varchar(191) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `Product` (
  `id` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `price` double NOT NULL,
  `stock` int(11) NOT NULL,
  `category` varchar(191) NOT NULL DEFAULT 'geral',
  `colors` varchar(191) NOT NULL,
  `sizes` varchar(191) NOT NULL,
  `imageUrl` varchar(191) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `imageUrls` varchar(2000) NOT NULL DEFAULT '',
  `description` text DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `ProductVariant` (
  `id` varchar(191) NOT NULL,
  `productId` varchar(191) NOT NULL,
  `color` varchar(191) NOT NULL,
  `size` varchar(191) NOT NULL,
  `stock` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

ALTER TABLE `Coupon`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`);

ALTER TABLE `Order`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `OrderItem`
  ADD PRIMARY KEY (`id`),
  ADD KEY `orderId` (`orderId`),
  ADD KEY `productId` (`productId`);

ALTER TABLE `Product`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `ProductVariant`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `ProductVariant_productId_color_size_key` (`productId`,`color`,`size`);

ALTER TABLE `OrderItem`
  ADD CONSTRAINT `OrderItem_ibfk_1` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`),
  ADD CONSTRAINT `OrderItem_ibfk_2` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`);

ALTER TABLE `ProductVariant`
  ADD CONSTRAINT `ProductVariant_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
