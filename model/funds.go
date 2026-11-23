package model

import "errors"

// GetEnabledChannelForBalance 取一条启用中的渠道，用于查询上游余额
func GetEnabledChannelForBalance() (*Channel, error) {
	var channel Channel
	err := DB.Where("status = ?", 1).Order("priority desc, id asc").First(&channel).Error
	if err != nil {
		return nil, errors.New("没有启用中的渠道")
	}
	return &channel, nil
}
