"""Klasik (İşNet örneği) e-belge XSLT'si.

İşNet, dönüşümden önce şu dizgeleri gerçek görselle değiştirir:
qrCodeImageString, firmaLogoImageString, firmaImzaImageString,
IsLogoExistsValue, IsEimzaLogoExistsValue.
Şablon XSLT 1.0'dır (lxml ile HTML üretilebilir). İşNet'in hazır
şablonları 2.0'dır; doğrulayıcı onları ayrıca kabul eder.
"""
from __future__ import annotations


def classic_isnet_xslt(kind: str = "e_invoice") -> str:
    dispatch = kind == "e_dispatch"
    doc = "DespatchAdvice" if dispatch else "Invoice"
    ns = (
        "urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"
        if dispatch
        else "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    )
    root = f"/n1:{doc}"
    supplier = (
        f"{root}/cac:DespatchSupplierParty/cac:Party"
        if dispatch
        else f"{root}/cac:AccountingSupplierParty/cac:Party"
    )
    customer = (
        f"{root}/cac:DeliveryCustomerParty/cac:Party"
        if dispatch
        else f"{root}/cac:AccountingCustomerParty/cac:Party"
    )
    line = f"{root}/cac:{'DespatchLine' if dispatch else 'InvoiceLine'}"
    qty = "cbc:DeliveredQuantity" if dispatch else "cbc:InvoicedQuantity"
    amount = (
        "cac:Shipment/cac:GoodsItem/cbc:ValueAmount"
        if dispatch
        else "cbc:LineExtensionAmount"
    )
    number_label = "İrsaliye No" if dispatch else "Fatura No"
    title = "e-İRSALİYE" if dispatch else ("e-ARŞİV" if kind == "e_archive" else "e-FATURA")
    desc_test = (
        f"{line}/cbc:Note[normalize-space(.)!=''] or "
        f"{line}/cac:Item/cbc:Description[normalize-space(.)!='']"
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:n1="{ns}"
  exclude-result-prefixes="cac cbc n1">
  <xsl:output method="html" indent="yes" encoding="UTF-8"/>
  <xsl:decimal-format name="tr" decimal-separator="," grouping-separator="."/>
  <xsl:variable name="IsLogoExists" select="'IsLogoExistsValue'"/>
  <xsl:variable name="IsEimzaLogoExists" select="'IsEimzaLogoExistsValue'"/>
  <xsl:template name="partyAddress">
    <xsl:param name="party"/>
    <xsl:variable name="street" select="normalize-space($party/cac:PostalAddress/cbc:StreetName)"/>
    <xsl:variable name="bname" select="normalize-space($party/cac:PostalAddress/cbc:BuildingName)"/>
    <xsl:variable name="bldg" select="normalize-space($party/cac:PostalAddress/cbc:BuildingNumber)"/>
    <xsl:variable name="dist" select="normalize-space($party/cac:PostalAddress/cbc:CitySubdivisionName)"/>
    <xsl:variable name="city" select="normalize-space($party/cac:PostalAddress/cbc:CityName)"/>
    <xsl:value-of select="$street"/>
    <xsl:if test="$bname!='' and not(contains($street,$bname))"><xsl:text> </xsl:text><xsl:value-of select="$bname"/></xsl:if>
    <xsl:if test="$bldg!='' and not(contains($street,$bldg)) and not(contains($bname,$bldg))"><xsl:text> No:</xsl:text><xsl:value-of select="$bldg"/></xsl:if>
    <xsl:if test="$dist!='' and not(contains($street,$dist))"><xsl:text> </xsl:text><xsl:value-of select="$dist"/></xsl:if>
    <xsl:if test="$city!='' and not(contains($street,$city)) and not(contains($dist,$city))"><xsl:text> / </xsl:text><xsl:value-of select="$city"/></xsl:if>
  </xsl:template>
  <xsl:template name="unitLabel">
    <xsl:param name="code"/>
    <xsl:choose>
      <xsl:when test="$code='C62' or $code='NIU' or $code='EA' or $code='Unit' or $code='UNIT' or $code='Adet'"><xsl:text>Adet</xsl:text></xsl:when>
      <xsl:when test="contains($code,'Adet')"><xsl:text>Adet</xsl:text></xsl:when>
      <xsl:when test="$code='KGM' or $code='KG'"><xsl:text>Kg</xsl:text></xsl:when>
      <xsl:when test="$code='LTR' or $code='L'"><xsl:text>Lt</xsl:text></xsl:when>
      <xsl:when test="$code='MTR'"><xsl:text>Mt</xsl:text></xsl:when>
      <xsl:when test="contains($code,'(')"><xsl:value-of select="substring-before($code,'(')"/></xsl:when>
      <xsl:otherwise><xsl:value-of select="$code"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>
  <xsl:template match="/">
    <html>
      <head>
        <meta charset="UTF-8"/>
        <title>{title}</title>
        <style type="text/css">
          body {{ font-family: Tahoma, Arial, sans-serif; font-size: 11px; color: #333; margin: 0; padding: 16px; }}
          .inv-brand-right {{ text-align: right; white-space: nowrap; }}
          .inv-box {{ border: 1px solid #ccc; padding: 8px; }}
          .inv-k {{ font-weight: 700; text-transform: uppercase; }}
          .inv-lines {{ border-collapse: collapse; width: 100%; }}
          .inv-lines th {{ background: #0f172a; color: #fff; }}
          .inv-lines th.inv-nowrap, .inv-lines td.inv-nowrap {{ white-space: nowrap; }}
          .inv-notes, .inv-iban {{ border: 1px solid #ccc; padding: 8px; }}
        </style>
      </head>
      <body>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="top"><div class="inv-k">{title}</div></td>
            <td class="inv-brand-right" align="right" valign="top">
              <xsl:choose>
                <xsl:when test="$IsLogoExists='true'">
                  <img alt="Firma Logo" style="height:72px;width:auto;" src="data:image/jpeg;base64,firmaLogoImageString"/>
                </xsl:when>
              </xsl:choose>
              <xsl:if test="$IsEimzaLogoExists='true'">
                <img style="width:91px;" alt="E-Imza Logo" src="data:image/jpeg;base64,firmaImzaImageString"/>
              </xsl:if>
              <img style="height:160px;width:160px;" alt="QrCode" src="data:image/jpeg;base64,qrCodeImageString"/>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="6" cellspacing="0">
          <tr>
            <td width="50%" valign="top">
              <div class="inv-box">
                <div class="inv-k">SATICI</div>
                <div><xsl:value-of select="{supplier}/cac:PartyName/cbc:Name"/></div>
                <div><xsl:call-template name="partyAddress"><xsl:with-param name="party" select="{supplier}"/></xsl:call-template></div>
                <div>VKN/TCKN: <xsl:value-of select="{supplier}/cac:PartyIdentification/cbc:ID"/></div>
              </div>
            </td>
            <td width="50%" valign="top">
              <div class="inv-box">
                <div class="inv-k">ALICI</div>
                <div><xsl:value-of select="{customer}/cac:PartyName/cbc:Name"/></div>
                <div><xsl:call-template name="partyAddress"><xsl:with-param name="party" select="{customer}"/></xsl:call-template></div>
                <div>VKN/TCKN: <xsl:value-of select="{customer}/cac:PartyIdentification/cbc:ID"/></div>
              </div>
            </td>
          </tr>
        </table>
        <table class="inv-meta" cellpadding="2" cellspacing="0">
          <xsl:if test="{root}/cbc:ID[normalize-space(.)!='']">
            <tr><td>{number_label}:</td><td><xsl:value-of select="{root}/cbc:ID"/></td></tr>
          </xsl:if>
          <xsl:if test="{root}/cbc:UUID[normalize-space(.)!='']">
            <tr><td>ETTN:</td><td><xsl:value-of select="{root}/cbc:UUID"/></td></tr>
          </xsl:if>
        </table>
        <table class="inv-lines" cellpadding="4" cellspacing="0">
          <thead><tr>
            <th>Sıra</th>
            <th>Stok Kodu</th>
            <th>Mal / Hizmet</th>
            <xsl:if test="{desc_test}"><th>Açıklama</th></xsl:if>
            <th>Barkod</th>
            <th>Miktar</th>
            <th class="inv-nowrap" style="white-space:nowrap">Birim</th>
            <th class="inv-nowrap" style="white-space:nowrap">KDV Tutarı</th>
            <th>Tutar</th>
          </tr></thead>
          <tbody>
            <xsl:for-each select="{line}">
              <tr>
                <td><xsl:value-of select="cbc:ID"/></td>
                <td><xsl:value-of select="cac:Item/cac:SellersItemIdentification/cbc:ID"/></td>
                <td><xsl:value-of select="cac:Item/cbc:Name"/></td>
                <xsl:if test="{desc_test}">
                  <td>
                    <xsl:value-of select="cbc:Note"/>
                    <xsl:if test="not(normalize-space(cbc:Note))"><xsl:value-of select="cac:Item/cbc:Description"/></xsl:if>
                  </td>
                </xsl:if>
                <td><xsl:value-of select="cac:Item/cac:AdditionalItemIdentification/cbc:ID"/><xsl:if test="not(cac:Item/cac:AdditionalItemIdentification/cbc:ID)"><xsl:value-of select="cac:Item/cac:StandardItemIdentification/cbc:ID"/></xsl:if></td>
                <td align="right"><xsl:value-of select="{qty}"/></td>
                <td class="inv-nowrap" style="white-space:nowrap">
                  <xsl:call-template name="unitLabel"><xsl:with-param name="code" select="{qty}/@unitCode"/></xsl:call-template>
                </td>
                <td class="inv-nowrap" align="right" style="white-space:nowrap">
                  <xsl:if test="cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode='0015']/cbc:TaxAmount!=''">
                    <xsl:value-of select="format-number(number(cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode='0015']/cbc:TaxAmount), '#.##0,00', 'tr')"/>
                  </xsl:if>
                </td>
                <td align="right">
                  <xsl:if test="{amount}!=''">
                    <xsl:value-of select="format-number(number({amount}), '#.##0,00', 'tr')"/>
                  </xsl:if>
                </td>
              </tr>
            </xsl:for-each>
          </tbody>
        </table>
        <table width="100%" cellpadding="6" cellspacing="0">
          <tr>
            <td width="50%" valign="top">
              <div class="inv-notes">
                <div class="inv-k">AÇIKLAMALAR</div>
                <xsl:for-each select="{root}/cbc:Note"><div><xsl:value-of select="."/></div></xsl:for-each>
              </div>
            </td>
            <td width="50%" valign="top">
              <div class="inv-iban">
                <div class="inv-k">BANKA HESAP BİLGİLERİMİZ</div>
                <div><xsl:value-of select="{root}/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID"/></div>
                <div><xsl:value-of select="{root}/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:Name"/></div>
              </div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
"""
