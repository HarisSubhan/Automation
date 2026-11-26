-- IRIS CAPTCHA module MySQL schema.
-- Apply with: mysql -u <user> -p < schema.sql

CREATE DATABASE IF NOT EXISTS iris_captcha
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE iris_captcha;

CREATE TABLE IF NOT EXISTS iris_sessions (
  id            VARCHAR(64)     NOT NULL,
  status        VARCHAR(32)     NOT NULL DEFAULT 'created',
  username      VARCHAR(190)    NOT NULL,
  password_enc  TEXT                NULL COMMENT 'AES-256-GCM encrypted password (v1:iv:tag:data)',
  captcha_text  VARCHAR(16)         NULL,
  error         TEXT                NULL,
  created_at    VARCHAR(32)     NOT NULL,
  updated_at    VARCHAR(32)     NOT NULL,
  expires_at    VARCHAR(32)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_iris_sessions_status (status),
  KEY idx_iris_sessions_updated (updated_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS iris_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(64)     NOT NULL,
  level      VARCHAR(16)     NOT NULL DEFAULT 'info',
  message    TEXT            NOT NULL,
  meta       TEXT                NULL,
  created_at VARCHAR(32)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_iris_events_session (session_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE USER IF NOT EXISTS 'iris'@'localhost' IDENTIFIED BY 'change-me';
GRANT SELECT, INSERT, UPDATE, DELETE ON iris_captcha.* TO 'iris'@'localhost';
FLUSH PRIVILEGES;
