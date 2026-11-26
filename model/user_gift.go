package model

import "time"

// GiftRecord 赠金发放记录（含有效期）
type GiftRecord struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	UserId    int    `json:"user_id" gorm:"index"`
	Amount    int    `json:"amount"` // 额度（quota 单位）
	Note      string `json:"note" gorm:"type:varchar(128)"`
	CreatedAt int64  `json:"created_at"`
	ExpiresAt int64  `json:"expires_at"`
	Status    string `json:"status" gorm:"type:varchar(16);default:'active'"`
}

func (GiftRecord) TableName() string { return "user_gift_records" }

// AddGiftRecord 发放赠金并记录有效期（默认 7 天）
func AddGiftRecord(userId, amount int, note string) error {
	if userId <= 0 || amount == 0 {
		return nil
	}
	if err := DB.AutoMigrate(&GiftRecord{}); err != nil {
		return err
	}
	now := time.Now().Unix()
	return DB.Create(&GiftRecord{
		UserId:    userId,
		Amount:    amount,
		Note:      note,
		CreatedAt: now,
		ExpiresAt: now + 7*24*3600,
		Status:    "active",
	}).Error
}
