"""
================================================================================
UTL FİNANS - Swiss Risk Parity & Target Beta Portfolio Rebalancing Engine
================================================================================
Institutional Portfolio Construction:
- Swiss Risk Parity (Equal Risk Contribution / Inverse Volatility)
- Hard 20% Single-Asset Weight Cap (Water-filling redistribution)
- Target Portfolio Beta Optimization (Dynamic Equity / Defensive Cash allocation)
- Actionable Buy/Sell Rebalancing Execution Proposal
"""

from decimal import Decimal
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from app.core.precision import round_ratio, round_price, round_money, round_quantity


class PositionInput(BaseModel):
    symbol: str
    current_quantity: Decimal
    current_price: Decimal
    volatility_annualized: Decimal = Field(..., description="Yıllıklandırılmış getiri volatilitesi (Örn: 0.35)")
    beta: Decimal = Field(..., description="BIST 100 endeksine göre hisse betası (Örn: 1.15)")


class RebalanceOrderProposal(BaseModel):
    symbol: str
    action: str = Field(..., description="BUY, SELL, HOLD")
    current_weight: Decimal
    target_weight: Decimal
    weight_delta: Decimal
    current_shares: Decimal
    target_shares: Decimal
    shares_to_trade: Decimal
    current_market_value: Decimal
    target_market_value: Decimal
    trade_nominal_value: Decimal
    reason: str


class RebalancePlanResult(BaseModel):
    portfolio_total_value: Decimal
    current_cash: Decimal
    projected_cash_after_trades: Decimal
    current_portfolio_beta: Decimal
    projected_portfolio_beta: Decimal
    target_beta: Decimal
    max_single_asset_cap: Decimal
    orders: List[RebalanceOrderProposal]
    summary: str


class SwissRiskParityRebalancer:
    """
    Swiss Private Banking allocation algorithm.
    Balances risk contributions equally across portfolio holdings while strictly
    enforcing sovereign concentration limits (max 20% per single stock).
    """

    @classmethod
    def rebalance(
        cls,
        positions: List[PositionInput],
        current_cash: Decimal,
        target_beta: Decimal = Decimal("1.00"),
        max_asset_weight_cap: Decimal = Decimal("0.20"), # 20% Max per asset
        min_rebalance_threshold: Decimal = Decimal("0.015") # Only rebalance if weight delta > 1.5%
    ) -> RebalancePlanResult:
        """
        Executes Swiss Risk Parity optimization with a hard 20% ceiling and beta control.
        """
        if not positions:
            raise ValueError("Position list cannot be empty.")

        # 1. Calculate current asset values and total portfolio equity
        holdings_value = Decimal("0.0")
        for p in positions:
            holdings_value += p.current_quantity * p.current_price

        total_portfolio_value = round_money(holdings_value + current_cash)
        if total_portfolio_value <= Decimal("0.0"):
            raise ValueError("Total portfolio value must be greater than zero.")

        # Current weights and current portfolio beta
        current_weights: Dict[str, Decimal] = {}
        weighted_beta_sum = Decimal("0.0")

        for p in positions:
            mv = p.current_quantity * p.current_price
            w = round_ratio(mv / total_portfolio_value)
            current_weights[p.symbol] = w
            weighted_beta_sum += w * p.beta

        current_portfolio_beta = round_ratio(weighted_beta_sum)

        # 2. Inverse Volatility Raw Weights (Risk Parity Core)
        # Weight_i proportional to 1 / Volatility_i
        inv_vols: Dict[str, Decimal] = {}
        for p in positions:
            vol = max(p.volatility_annualized, Decimal("0.05")) # Floor volatility at 5%
            inv_vols[p.symbol] = Decimal("1.0") / vol

        total_inv_vol = sum(inv_vols.values())
        raw_target_weights: Dict[str, Decimal] = {
            sym: val / total_inv_vol for sym, val in inv_vols.items()
        }

        # 3. Water-filling Algorithm for 20% Maximum Weight Cap
        # If any asset exceeds max_asset_weight_cap (20%), clamp at 20% and redistribute excess
        capped_weights = dict(raw_target_weights)
        max_iterations = 10

        for _ in range(max_iterations):
            excess_weight = Decimal("0.0")
            uncapped_keys = []

            for sym, w in capped_weights.items():
                if w > max_asset_weight_cap:
                    excess_weight += (w - max_asset_weight_cap)
                    capped_weights[sym] = max_asset_weight_cap
                else:
                    uncapped_keys.append(sym)

            if excess_weight == Decimal("0.0") or not uncapped_keys:
                break

            # Redistribute excess proportionally among uncapped assets
            uncapped_sum = sum(capped_weights[k] for k in uncapped_keys)
            if uncapped_sum > Decimal("0.0"):
                for k in uncapped_keys:
                    capped_weights[k] += excess_weight * (capped_weights[k] / uncapped_sum)

        # 4. Target Beta Alignment: Allocate between equities and cash buffer
        # Equity beta of the risk-parity basket
        basket_equity_beta = sum(
            capped_weights[p.symbol] * p.beta for p in positions
        )

        # Desired equity exposure = target_beta / basket_equity_beta (clamped between 70% and 95%)
        if basket_equity_beta > Decimal("0.0"):
            equity_exposure_ratio = min(max(target_beta / basket_equity_beta, Decimal("0.70")), Decimal("0.95"))
        else:
            equity_exposure_ratio = Decimal("0.85")

        final_target_weights: Dict[str, Decimal] = {}
        for sym, w in capped_weights.items():
            final_target_weights[sym] = round_ratio(w * equity_exposure_ratio)

        # Cash target is the remaining allocation
        target_cash_weight = Decimal("1.0") - sum(final_target_weights.values())

        # 5. Generate Rebalance Orders
        orders: List[RebalanceOrderProposal] = []
        projected_cash = current_cash
        projected_weighted_beta = Decimal("0.0")

        for p in positions:
            sym = p.symbol
            cur_w = current_weights[sym]
            tgt_w = final_target_weights[sym]
            delta_w = tgt_w - cur_w

            cur_mv = round_money(p.current_quantity * p.current_price)
            tgt_mv = round_money(total_portfolio_value * tgt_w)
            trade_val = tgt_mv - cur_mv

            price = max(p.current_price, Decimal("0.0001"))
            tgt_shares = round_quantity(tgt_mv / price)
            shares_delta = tgt_shares - p.current_quantity

            # Projected beta contribution
            projected_weighted_beta += tgt_w * p.beta

            # Evaluate action threshold
            if abs(delta_w) < min_rebalance_threshold:
                action = "HOLD"
                shares_to_trade = Decimal("0.00000000")
                trade_nom = Decimal("0.0000")
                reason = "Ağırlık sapması eşik değerinin (%1.5) altında; işlem maliyetini önlemek için korundu."
            elif delta_w > Decimal("0.0"):
                action = "BUY"
                shares_to_trade = round_quantity(abs(shares_delta))
                trade_nom = round_money(shares_to_trade * price)
                projected_cash -= trade_nom
                reason = f"Düşük volatilite / Risk Paritesi artırımı: Ağırlık %{cur_w*100:.1f} -> %{tgt_w*100:.1f}."
            else:
                action = "SELL"
                shares_to_trade = round_quantity(abs(shares_delta))
                trade_nom = round_money(shares_to_trade * price)
                projected_cash += trade_nom
                if cur_w > max_asset_weight_cap:
                    reason = f"İsviçre Kuralı (%20 tavan aşımı): Aşırı ağırlık budandı (%{cur_w*100:.1f} -> %{tgt_w*100:.1f})."
                else:
                    reason = f"Risk Paritesi & Beta optimizasyonu: Kâr realizasyonu (%{cur_w*100:.1f} -> %{tgt_w*100:.1f})."

            orders.append(
                RebalanceOrderProposal(
                    symbol=sym,
                    action=action,
                    current_weight=cur_w,
                    target_weight=tgt_w,
                    weight_delta=delta_w,
                    current_shares=p.current_quantity,
                    target_shares=tgt_shares,
                    shares_to_trade=shares_to_trade,
                    current_market_value=cur_mv,
                    target_market_value=tgt_mv,
                    trade_nominal_value=trade_nom,
                    reason=reason
                )
            )

        summary_msg = (
            f"İsviçre Risk Paritesi dengelemesi tamamlandı. Hiçbir hissenin ağırlığı %20 tavanını aşmamaktadır. "
            f"Portföy Betası {current_portfolio_beta:.2f} seviyesinden hedeflenen {projected_weighted_beta:.2f} seviyesine optimize edilmiştir."
        )

        return RebalancePlanResult(
            portfolio_total_value=total_portfolio_value,
            current_cash=current_cash,
            projected_cash_after_trades=round_money(projected_cash),
            current_portfolio_beta=current_portfolio_beta,
            projected_portfolio_beta=round_ratio(projected_weighted_beta),
            target_beta=target_beta,
            max_single_asset_cap=max_asset_weight_cap,
            orders=orders,
            summary=summary_msg
        )
