CREATE DATABASE IF NOT EXISTS durg_mitra
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE durg_mitra;

CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id CHAR(36) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  mobile VARCHAR(24) NOT NULL,
  gender VARCHAR(40) NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL,
  state VARCHAR(120) NOT NULL,
  district VARCHAR(120) NOT NULL,
  address VARCHAR(255) NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  otp_hash CHAR(64) NOT NULL,
  reset_token_hash CHAR(64) NULL,
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL,
  used_at DATETIME NULL,
  INDEX idx_password_reset_user_created (user_id, created_at),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Passwords are intentionally stored as bcrypt hashes. There is no plaintext
-- password column and a stored hash cannot be converted back to the password.
