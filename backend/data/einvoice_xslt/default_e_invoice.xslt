<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
	xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
	xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
	xmlns:ccts="urn:un:unece:uncefact:documentation:2"
	xmlns:clm54217="urn:un:unece:uncefact:codelist:specification:54217:2001"
	xmlns:clm5639="urn:un:unece:uncefact:codelist:specification:5639:1988"
	xmlns:clm66411="urn:un:unece:uncefact:codelist:specification:66411:2001"
	xmlns:clmIANAMIMEMediaType="urn:un:unece:uncefact:codelist:specification:IANAMIMEMediaType:2003"
	xmlns:fn="http://www.w3.org/2005/xpath-functions" xmlns:link="http://www.xbrl.org/2003/linkbase"
	xmlns:n1="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
	xmlns:qdt="urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2"
	xmlns:udt="urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2"
	xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:xbrli="http://www.xbrl.org/2003/instance"
	xmlns:xdt="http://www.w3.org/2005/xpath-datatypes" xmlns:xlink="http://www.w3.org/1999/xlink"
	xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	exclude-result-prefixes="cac cbc ccts clm54217 clm5639 clm66411 clmIANAMIMEMediaType fn link n1 qdt udt xbrldi xbrli xdt xlink xs xsd xsi">
	<xsl:character-map name="a">
		<xsl:output-character character="&#133;" string=""/>
		<xsl:output-character character="&#158;" string=""/>
	</xsl:character-map>
	<xsl:decimal-format name="european" decimal-separator="," grouping-separator="." NaN=""/>
	<xsl:output version="4.0" method="html" indent="no" encoding="UTF-8"
		doctype-public="-//W3C//DTD HTML 4.01 Transitional//EN"
		doctype-system="http://www.w3.org/TR/html4/loose.dtd" use-character-maps="a"/>
	<xsl:param name="SV_OutputFormat" select="'HTML'"/>
	<xsl:variable name="XML" select="/"/>
	<xsl:variable name ="VATCount" select = "count(/n1:Invoice/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode[text() = '0015'])"/>
	<xsl:variable name ="IsLogoExists" select="'IsLogoExistsValue'" />
	<xsl:template match="/">
		<html>
			<head>
				<title/>
				<style type="text/css">
					body {
					background-color: #FFFFFF;
					font-family: 'Tahoma', "Times New Roman", Times, serif;
					font-size: 11px;
					color: #666666;
					}
					h1, h2 {
					padding-bottom: 3px;
					padding-top: 3px;
					margin-bottom: 5px;
					text-transform: uppercase;
					font-family: Arial, Helvetica, sans-serif;
					}
					h1 {
					font-size: 1.4em;
					text-transform:none;
					}
					h2 {
					font-size: 1em;
					color: brown;
					}
					h3 {
					font-size: 1em;
					color: #333333;
					text-align: justify;
					margin: 0;
					padding: 0;
					}
					h4 {
					font-size: 1.1em;
					font-style: bold;
					font-family: Arial, Helvetica, sans-serif;
					color: #000000;
					margin: 0;
					padding: 0;
					}
					hr {
					height:2px;
					color: #000000;
					background-color: #000000;
					border-bottom: 1px solid #000000;
					}
					p, ul, ol {
					margin-top: 1.5em;
					}
					ul, ol {
					margin-left: 3em;
					}
					blockquote {
					margin-left: 3em;
					margin-right: 3em;
					font-style: italic;
					}
					a {
					text-decoration: none;
					color: #70A300;
					}
					a:hover {
					border: none;
					color: #70A300;
					}
					#despatchTable {
					border-collapse:collapse;
					font-size:11px;
					float:right;
					border-color:gray;
					}
					#ettnTable {
					border-collapse:collapse;
					font-size:11px;
					border-color:gray;
					}
					#customerPartyTable {
					border-width: 0px;
					border-spacing:;
					border-style: inset;
					border-color: gray;
					border-collapse: collapse;
					background-color:
					}
					#customerIDTable {
					border-width: 2px;
					border-spacing:;
					border-style: inset;
					border-color: gray;
					border-collapse: collapse;
					background-color:
					}
					#customerIDTableTd {
					border-width: 2px;
					border-spacing:;
					border-style: inset;
					border-color: gray;
					border-collapse: collapse;
					background-color:
					}
					#lineTable {
					border-width:2px;
					border-spacing:;
					border-style: inset;
					border-color: black;
					border-collapse: collapse;
					background-color:;
					}
					#lineTableTd {
					border-width: 1px;
					padding: 1px;
					border-style: inset;
					border-color: black;
					background-color: white;
					}
					#lineTableTr {
					border-width: 1px;
					padding: 0px;
					border-style: inset;
					border-color: black;
					background-color: white;
					-moz-border-radius:;
					}
					#lineTableDummyTd {
					border-width: 1px;
					border-color:white;
					padding: 1px;
					border-style: inset;
					border-color: black;
					background-color: white;
					}
					td.lineTableBudgetTd {
					border-width: 2px;
					border-spacing:0px;
					padding: 1px;
					border-style: inset;
					border-color: black;
					background-color: white;
					-moz-border-radius:;
					}
					#notesTable {
					border-width: 2px;
					border-spacing:;
					border-style: inset;
					border-color: black;
					border-collapse: collapse;
					background-color:
					}
					#notesTableTd {
					border-width: 0px;
					border-spacing:;
					border-style: inset;
					border-color: black;
					border-collapse: collapse;
					background-color:
					}
					table {
					border-spacing:0px;
					}
					#budgetContainerTable {
					border-width: 0px;
					border-spacing: 0px;
					border-style: inset;
					border-color: black;
					border-collapse: collapse;
					background-color:;
					}
					td {
					border-color:gray;
					}
				</style>
				<title>e-Fatura</title>
			</head>
			<body
				style="margin-left=0.6in; margin-right=0.6in; margin-top=0.79in; margin-bottom=0.79in">
				<xsl:for-each select="$XML">
					<table style="border-color:blue; " border="0" cellspacing="0px" width="800"
						cellpadding="0px">
						<tbody>
							<tr valign="top">
								<td width="40%">
									<br/>
									<table align="center" border="0" width="100%">
										<tbody>
											<hr/>
											<tr align="left">
												<xsl:for-each select="n1:Invoice/cac:AccountingSupplierParty/cac:Party">
													<td align="left">
														<xsl:if test="cac:PartyName">
															<xsl:value-of select="cac:PartyName/cbc:Name"/>
															<br/>
														</xsl:if>
														<xsl:for-each select="cac:Person">
															<xsl:for-each select="cbc:Title">
																<xsl:apply-templates/>
																<xsl:text>&#160;</xsl:text>
															</xsl:for-each>
															<xsl:for-each select="cbc:FirstName">
																<xsl:apply-templates/>
																<xsl:text>&#160;</xsl:text>
															</xsl:for-each>
															<xsl:for-each select="cbc:MiddleName">
																<xsl:apply-templates/>
																<xsl:text>&#160;</xsl:text>
															</xsl:for-each>
															<xsl:for-each select="cbc:FamilyName">
																<xsl:apply-templates/>
																<xsl:text>&#160;</xsl:text>
															</xsl:for-each>
															<xsl:for-each select="cbc:NameSuffix">
																<xsl:apply-templates/>
															</xsl:for-each>
														</xsl:for-each>
													</td>
												</xsl:for-each>
											</tr>
											<tr align="left">
												<xsl:for-each select="n1:Invoice/cac:AccountingSupplierParty/cac:Party">
													<td align="left">
														<xsl:for-each select="cac:PostalAddress">
															<xsl:for-each select="cbc:StreetName">
																<xsl:apply-templates/>
																<xsl:text>&#160;</xsl:text>
															</xsl:for-each>
															<xsl:for-each select="cbc:BuildingName">
																<xsl:apply-templates/>
															</xsl:for-each>
															<xsl:if test="cbc:BuildingNumber">
																<xsl:text> No:</xsl:text>
																<xsl:for-each select="cbc:BuildingNumber">
																	<xsl:apply-templates/>
																</xsl:for-each>
																<xsl:text>&#160;</xsl:text>
															</xsl:if>
															<br/>
															<xsl:for-each select="cbc:PostalZone">
																<xsl:apply-templates/>
																<xsl:text>&#160;</xsl:text>
															</xsl:for-each>
															<xsl:for-each select="cbc:CitySubdivisionName">
																<xsl:apply-templates/>
															</xsl:for-each>
															<xsl:text>/ </xsl:text>
															<xsl:for-each select="cbc:CityName">
																<xsl:apply-templates/>
																<xsl:text>&#160;</xsl:text>
															</xsl:for-each>
														</xsl:for-each>
													</td>
												</xsl:for-each>
											</tr>
											<xsl:if
												test="//n1:Invoice/cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Telephone or //n1:Invoice/cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Telefax">
												<tr align="left">
													<xsl:for-each select="n1:Invoice/cac:AccountingSupplierParty/cac:Party">
														<td align="left">
															<xsl:for-each select="cac:Contact">
																<xsl:if test="cbc:Telephone">
																	<xsl:text>Tel: </xsl:text>
																	<xsl:for-each select="cbc:Telephone">
																		<xsl:apply-templates/>
																	</xsl:for-each>
																</xsl:if>
																<xsl:if test="cbc:Telefax">
																	<xsl:text> Fax: </xsl:text>
																	<xsl:for-each select="cbc:Telefax">
																		<xsl:apply-templates/>
																	</xsl:for-each>
																</xsl:if>
																<xsl:text>&#160;</xsl:text>
															</xsl:for-each>
														</td>
													</xsl:for-each>
												</tr>
											</xsl:if>
											<xsl:for-each
												select="//n1:Invoice/cac:AccountingSupplierParty/cac:Party/cbc:WebsiteURI">
												<tr align="left">
													<td>
														<xsl:text>Web Sitesi: </xsl:text>
														<xsl:value-of select="."/>
													</td>
												</tr>
											</xsl:for-each>
											<xsl:for-each
												select="//n1:Invoice/cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:ElectronicMail">
												<tr align="left">
													<td>
														<xsl:text>E-Posta: </xsl:text>
														<xsl:value-of select="."/>
													</td>
												</tr>
											</xsl:for-each>
											<tr align="left">
												<xsl:for-each select="n1:Invoice/cac:AccountingSupplierParty/cac:Party">
													<td align="left">
														<xsl:text>Vergi Dairesi: </xsl:text>
														<xsl:for-each select="cac:PartyTaxScheme">
															<xsl:for-each select="cac:TaxScheme">
																<xsl:for-each select="cbc:Name">
																	<xsl:apply-templates/>
																</xsl:for-each>
															</xsl:for-each>
															<xsl:text>&#160; </xsl:text>
														</xsl:for-each>
													</td>
												</xsl:for-each>
											</tr>
											<xsl:for-each select="//n1:Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification">
												<xsl:choose>
													<xsl:when test="cbc:ID/@schemeID ='MERSISNO'">
														<tr align="left">
															<td>
																<xsl:text>Mersis No: </xsl:text>
																<xsl:value-of select="cbc:ID"/>
															</td>
														</tr>
													</xsl:when>
													
													<xsl:when test="cbc:ID/@schemeID ='TICARETSICILNO'">
														<tr align="left">
															<td>
																<xsl:text>Ticaret Sicil No: </xsl:text>
																<xsl:value-of select="cbc:ID"/>
															</td>
														</tr>
													</xsl:when>
													
													<xsl:when test="cbc:ID/@schemeID ='HIZMETNO'">
														<tr align="left">
															<td>
																<xsl:text>Hizmet No: </xsl:text>
																<xsl:value-of select="cbc:ID"/>
															</td>
														</tr>
													</xsl:when>
														
													<xsl:otherwise>
														<tr align="left">
															<td>
																<xsl:value-of select="cbc:ID/@schemeID"/>
																<xsl:text>: </xsl:text>
																<xsl:value-of select="cbc:ID"/>
															</td>
														</tr>

													</xsl:otherwise>
														
												</xsl:choose>
											</xsl:for-each>
										</tbody>
									</table>
									<hr/>
								</td>
								<td width="20%" align="center" valign="middle">
									<br/>
									<br/>
									<img style="width:91px;" align="middle" alt="E-Fatura Logo"
                  src="data:image/jpeg;base64,/9j/4QAYRXhpZgAASUkqAAgAAAAAAAAAAAAAAP/sABFEdWNreQABAAQAAABkAAD/4QMZaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjYtYzEzMiA3OS4xNTkyODQsIDIwMTYvMDQvMTktMTM6MTM6NDAgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIiB4bWxuczpzdFJlZj0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlUmVmIyIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjZDNDJBNEI2QjVCRDExRThCQjM0REIwQkZGMEQxODY0IiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjZDNDJBNEI1QjVCRDExRThCQjM0REIwQkZGMEQxODY0IiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCBDUzQgV2luZG93cyI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSIzREVENkU1N0FDREVDNEJBNzkxNUM2M0NCN0RENzM0NyIgc3RSZWY6ZG9jdW1lbnRJRD0iM0RFRDZFNTdBQ0RFQzRCQTc5MTVDNjNDQjdERDczNDciLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7/7gAOQWRvYmUAZMAAAAAB/9sAhAABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB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"/>

									<h1 align="center">
										<span style="font-weight:bold; ">
											<xsl:text>e-FATURA</xsl:text>
										</span>
									</h1>
								</td>
								<td width="40%" align="right" valign="middle">
											<br/>
											<br/>
											<img style="height:160px;width:160px;" alt="QrCode"
												src="data:image/jpeg;base64,qrCodeImageString"/>
								</td>
							</tr>
							<xsl:if test="//n1:Invoice/cbc:ProfileID='TEMELFATURA' or //n1:Invoice/cbc:ProfileID='TICARIFATURA' or //n1:Invoice/cbc:ProfileID='HKS' or //n1:Invoice/cbc:ProfileID='IHRACAT' or //n1:Invoice/cbc:ProfileID='YOLCUBERABERFATURA'">
							<tr style="height:118px; " valign="top">
								<td width="40%" align="right" valign="bottom">
									<table id="customerPartyTable" align="left" border="0"
										height="50%">
										<tbody>
											<tr style="height:71px; ">
												<td>
													<hr/>
													<table align="center" border="0">
														<tbody>
															<tr>
																<xsl:for-each select="n1:Invoice/cac:AccountingCustomerParty/cac:Party">
																	<td style="width:469px; " align="left">
																		<span style="font-weight:bold; ">
																			<xsl:text>SAYIN</xsl:text>
																		</span>
																	</td>
																</xsl:for-each>
															</tr>
															<tr>
																<xsl:choose>
																	<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='TAXFREE']">
																		<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																			<xsl:call-template name="Party_Title">
																				<xsl:with-param name="PartyType">TAXFREE</xsl:with-param>
																			</xsl:call-template>
																		</xsl:for-each>
																	</xsl:when>
																	<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='EXPORT']">
																		<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																			<xsl:call-template name="Party_Title">
																				<xsl:with-param name="PartyType">EXPORT</xsl:with-param>
																			</xsl:call-template>
																		</xsl:for-each>
																	</xsl:when>
																	<xsl:otherwise>
																		<xsl:for-each select="n1:Invoice/cac:AccountingCustomerParty/cac:Party">
																			<xsl:call-template name="Party_Title">
																				<xsl:with-param name="PartyType">OTHER</xsl:with-param>
																			</xsl:call-template>
																		</xsl:for-each>
																	</xsl:otherwise>
																</xsl:choose>
															</tr>
															<xsl:choose>
																<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='TAXFREE']">
																	<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																		<tr>
																			<xsl:call-template name="Party_Adress">
																				<xsl:with-param name="PartyType">TAXFREE</xsl:with-param>
																			</xsl:call-template>
																		</tr>
																		<xsl:call-template name="Party_Other">
																			<xsl:with-param name="PartyType">TAXFREE</xsl:with-param>
																		</xsl:call-template>
																	</xsl:for-each>
																</xsl:when>
																<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='EXPORT']">
																	<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																		<tr>
																			<xsl:call-template name="Party_Adress">
																				<xsl:with-param name="PartyType">EXPORT</xsl:with-param>
																			</xsl:call-template>
																		</tr>
																		<xsl:call-template name="Party_Other">
																			<xsl:with-param name="PartyType">EXPORT</xsl:with-param>
																		</xsl:call-template>
																	</xsl:for-each>
																</xsl:when>
																<xsl:otherwise>
																	<xsl:for-each select="n1:Invoice/cac:AccountingCustomerParty/cac:Party">
																		<tr>
																			<xsl:call-template name="Party_Adress">
																				<xsl:with-param name="PartyType">OTHER</xsl:with-param>
																			</xsl:call-template>
																		</tr>
																		<xsl:call-template name="Party_Other">
																			<xsl:with-param name="PartyType">OTHER</xsl:with-param>
																		</xsl:call-template>
																	</xsl:for-each>
																</xsl:otherwise>
															</xsl:choose>
														</tbody>
													</table>
													<hr/>
												</td>
											</tr>
										</tbody>
									</table>
									<br/>
								</td>
								<td width="30%" align="center" valign="bottom">
									<!-- <xsl:choose> -->
										<!-- <xsl:when test="$IsLogoExists='true'"> -->
											<!-- <br/> -->
											<!-- <br/> -->
											<!-- <img style="width:50%;" align="middle" alt="E-Fatura Logo" -->
												<!-- src="data:image/jpeg;base64,firmaLogoImageString"/> -->
										<!-- </xsl:when> -->
										<!-- <xsl:otherwise> -->
											<!-- <br/> -->
											<!-- <br/> -->
											<!-- <img style="height:160px;width:160px;" alt="QrCode" -->
												<!-- src="data:image/jpeg;base64,qrCodeImageString"/> -->
										<!-- </xsl:otherwise> -->
									<!-- </xsl:choose> -->
								</td>
								<td width="30%" valign="bottom">
									<table border="1" height="13" id="despatchTable">
										<tbody>
											<tr>
												<td style="width:105px;" align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Özelleştirme No:</xsl:text>
													</span>
												</td>
												<td style="width:110px;" align="left">
													<xsl:for-each select="n1:Invoice/cbc:CustomizationID">
														<xsl:apply-templates/>
													</xsl:for-each>
												</td>
											</tr>
											<tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Senaryo:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:ProfileID">
														<xsl:apply-templates/>
													</xsl:for-each>
												</td>
											</tr>
											<tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Fatura Tipi:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:InvoiceTypeCode">
														<xsl:apply-templates/>
													</xsl:for-each>
												</td>
											</tr>
											<tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Fatura No:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:ID">
														<xsl:apply-templates/>
													</xsl:for-each>
												</td>
											</tr>
											<tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Fatura Tarihi:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:IssueDate">
														<xsl:apply-templates select="."/>
													</xsl:for-each>
												</td>
											</tr>
                                            <tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Düzenleme Tarihi:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:IssueDate">
														<xsl:apply-templates select="."/>
													</xsl:for-each>
												</td>
											</tr>
											<xsl:if test="n1:Invoice/cbc:IssueTime!=''">
												<tr style="height:13px; ">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Düzenleme Zamanı:</xsl:text>
														</span>
													</td>
													<td align="left">
														<xsl:for-each select="n1:Invoice/cbc:IssueTime">
															<xsl:apply-templates select="."/>
														</xsl:for-each>
													</td>
												</tr>
											</xsl:if>
											<xsl:for-each select="n1:Invoice/cac:DespatchDocumentReference">
												<tr style="height:13px; ">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>İrsaliye No:</xsl:text>
														</span>
														<xsl:text>&#160;</xsl:text>
													</td>
													<td align="left">
														<xsl:value-of select="cbc:ID"/>
													</td>
												</tr>
												<tr style="height:13px; ">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>İrsaliye Tarihi:</xsl:text>
														</span>
													</td>
													<td align="left">
														<xsl:for-each select="cbc:IssueDate">
															<xsl:apply-templates select="."/>
														</xsl:for-each>
													</td>
												</tr>
											</xsl:for-each>
											<xsl:if test="//n1:Invoice/cac:OrderReference">
												<tr style="height:13px">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Sipariş No:</xsl:text>
														</span>
													</td>
													<td align="left">
														<xsl:for-each select="n1:Invoice/cac:OrderReference/cbc:ID">
															<xsl:apply-templates/>
														</xsl:for-each>
													</td>
												</tr>
											</xsl:if>
											<xsl:if	test="//n1:Invoice/cac:OrderReference/cbc:IssueDate">
												<tr style="height:13px">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Sipariş Tarihi:</xsl:text>
														</span>
													</td>
													<td align="left">
														<xsl:for-each select="n1:Invoice/cac:OrderReference/cbc:IssueDate">
															<xsl:apply-templates select="."/>
														</xsl:for-each>
													</td>
												</tr>
											</xsl:if>
											<xsl:for-each select="n1:Invoice/cac:TaxRepresentativeParty/cac:PartyIdentification/cbc:ID[@schemeID='ARACIKURUMVKN']">
												<tr>
													<td style="width:105px;" align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Aracı Kurum VKN:</xsl:text>
														</span>
													</td>
													<td style="width:110px;" align="left">
														<xsl:value-of select="."/>
													</td>
												</tr>
												<tr>
													<td style="width:105px;" align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Aracı Kurum Unvan:</xsl:text>
														</span>
													</td>
													<td style="width:110px;" align="left">
														<xsl:value-of select="../../cac:PartyName/cbc:Name"/>
													</td>
												</tr>
											</xsl:for-each>
											<xsl:if test="//n1:Invoice/cac:PaymentMeans/cbc:PaymentDueDate">
												<tr style="height:13px">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Son Ödeme Tarihi</xsl:text>
														</span>
													</td>
													<td align="left">
														<xsl:value-of select="substring(//n1:Invoice/cac:PaymentMeans/cbc:PaymentDueDate,9,2)"/>-<xsl:value-of select="substring(//n1:Invoice/cac:PaymentMeans/cbc:PaymentDueDate,6,2)"/>-<xsl:value-of select="substring(//n1:Invoice/cac:PaymentMeans/cbc:PaymentDueDate,1,4)"/>
													</td>
												</tr>
											</xsl:if>
										</tbody>
									</table>
								</td>
							</tr>
							</xsl:if>
							<xsl:if test="//n1:Invoice/cbc:ProfileID='KAMU'">
							<tr style="height:118px; " valign="top">
								<td width="40%" align="right" valign="bottom">
									<table id="customerPartyTable" align="left" border="0"
										height="50%">
										<tbody>
											<tr style="height:71px; ">
												<td>
													<hr/>
													<table align="center" border="0">
														<tbody>
															<tr>
																<xsl:for-each select="n1:Invoice/cac:AccountingCustomerParty/cac:Party">
																	<td style="width:469px; " align="left">
																		<span style="font-weight:bold; ">
																			<xsl:text>SAYIN</xsl:text>
																		</span>
																	</td>
																</xsl:for-each>
															</tr>
															<tr>
																<xsl:choose>
																	<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='TAXFREE']">
																		<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																			<xsl:call-template name="Party_Title">
																				<xsl:with-param name="PartyType">TAXFREE</xsl:with-param>
																			</xsl:call-template>
																		</xsl:for-each>
																	</xsl:when>
																	<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='EXPORT']">
																		<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																			<xsl:call-template name="Party_Title">
																				<xsl:with-param name="PartyType">EXPORT</xsl:with-param>
																			</xsl:call-template>
																		</xsl:for-each>
																	</xsl:when>
																	<xsl:otherwise>
																		<xsl:for-each select="n1:Invoice/cac:AccountingCustomerParty/cac:Party">
																			<xsl:call-template name="Party_Title">
																				<xsl:with-param name="PartyType">OTHER</xsl:with-param>
																			</xsl:call-template>
																		</xsl:for-each>
																	</xsl:otherwise>
																</xsl:choose>
															</tr>
															<xsl:choose>
																<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='TAXFREE']">
																	<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																		<tr>
																			<xsl:call-template name="Party_Adress">
																				<xsl:with-param name="PartyType">TAXFREE</xsl:with-param>
																			</xsl:call-template>
																		</tr>
																		<xsl:call-template name="Party_Other">
																			<xsl:with-param name="PartyType">TAXFREE</xsl:with-param>
																		</xsl:call-template>
																	</xsl:for-each>
																</xsl:when>
																<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='EXPORT']">
																	<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																		<tr>
																			<xsl:call-template name="Party_Adress">
																				<xsl:with-param name="PartyType">EXPORT</xsl:with-param>
																			</xsl:call-template>
																		</tr>
																		<xsl:call-template name="Party_Other">
																			<xsl:with-param name="PartyType">EXPORT</xsl:with-param>
																		</xsl:call-template>
																	</xsl:for-each>
																</xsl:when>
																<xsl:otherwise>
																	<xsl:for-each select="n1:Invoice/cac:AccountingCustomerParty/cac:Party">
																		<tr>
																			<xsl:call-template name="Party_Adress">
																				<xsl:with-param name="PartyType">OTHER</xsl:with-param>
																			</xsl:call-template>
																		</tr>
																		<xsl:call-template name="Party_Other">
																			<xsl:with-param name="PartyType">OTHER</xsl:with-param>
																		</xsl:call-template>
																	</xsl:for-each>
																</xsl:otherwise>
															</xsl:choose>
														</tbody>
													</table>
													<hr/>
												</td>
											</tr>
										</tbody>
									</table>
									<br/>
								</td>
								<td width="30%" align="center" valign="bottom">
									
								</td>
								<td width="30%" valign="bottom">
									
								</td>
							</tr>
							<tr style="height:118px; " valign="top">
								<td width="40%" align="right" valign="bottom">
									<table id="customerPartyTable" align="left" border="0"
										height="50%">
										<tbody>
											<tr style="height:71px; ">
												<td>
													<hr/>
													<table align="center" border="0">
														<tbody>
															<tr>
																<xsl:for-each select="n1:Invoice/cac:AccountingCustomerParty/cac:Party">
																	<td style="width:469px; " align="left">
																		<span style="font-weight:bold; ">
																			<xsl:text>HARCAMA BIRIMI</xsl:text>
																		</span>
																	</td>
																</xsl:for-each>
															</tr>
															<tr>
																<xsl:choose>
																	<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='TAXFREE']">
																		<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																			<xsl:call-template name="Party_Title">
																				<xsl:with-param name="PartyType">TAXFREE</xsl:with-param>
																			</xsl:call-template>
																		</xsl:for-each>
																	</xsl:when>
																	<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='EXPORT']">
																		<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																			<xsl:call-template name="Party_Title">
																				<xsl:with-param name="PartyType">EXPORT</xsl:with-param>
																			</xsl:call-template>
																		</xsl:for-each>
																	</xsl:when>
																	<xsl:otherwise>
																		<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																			<xsl:call-template name="Party_Title">
																				<xsl:with-param name="PartyType">OTHER</xsl:with-param>
																			</xsl:call-template>
																		</xsl:for-each>
																	</xsl:otherwise>
																</xsl:choose>
															</tr>
															<xsl:choose>
																<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='TAXFREE']">
																	<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																		<tr>
																			<xsl:call-template name="Party_Adress">
																				<xsl:with-param name="PartyType">TAXFREE</xsl:with-param>
																			</xsl:call-template>
																		</tr>
																		<xsl:call-template name="Party_Other">
																			<xsl:with-param name="PartyType">TAXFREE</xsl:with-param>
																		</xsl:call-template>
																	</xsl:for-each>
																</xsl:when>
																<xsl:when test="n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE' and text()='EXPORT']">
																	<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																		<tr>
																			<xsl:call-template name="Party_Adress">
																				<xsl:with-param name="PartyType">EXPORT</xsl:with-param>
																			</xsl:call-template>
																		</tr>
																		<xsl:call-template name="Party_Other">
																			<xsl:with-param name="PartyType">EXPORT</xsl:with-param>
																		</xsl:call-template>
																	</xsl:for-each>
																</xsl:when>
																<xsl:otherwise>
																	<xsl:for-each select="n1:Invoice/cac:BuyerCustomerParty/cac:Party">
																		<tr>
																			<xsl:call-template name="Party_Adress">
																				<xsl:with-param name="PartyType">OTHER</xsl:with-param>
																			</xsl:call-template>
																		</tr>
																		<xsl:call-template name="Party_Other">
																			<xsl:with-param name="PartyType">OTHER</xsl:with-param>
																		</xsl:call-template>
																	</xsl:for-each>
																</xsl:otherwise>
															</xsl:choose>
														</tbody>
													</table>
													<hr/>
												</td>
											</tr>
										</tbody>
									</table>
									<br/>
								</td>
								<td width="30%" align="center" valign="bottom">
									<xsl:choose>
										<xsl:when test="$IsLogoExists='true'">
											<br/>
											<br/>
											<img style="width:50%;" align="middle" alt="E-Fatura Logo"
												src="data:image/jpeg;base64,firmaLogoImageString"/>
										</xsl:when>
									</xsl:choose>
								</td>
								<td width="30%" valign="bottom">
									<table border="1" height="13" id="despatchTable">
										<tbody>
											<tr>
												<td style="width:105px;" align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Özelleştirme No:</xsl:text>
													</span>
												</td>
												<td style="width:110px;" align="left">
													<xsl:for-each select="n1:Invoice/cbc:CustomizationID">
														<xsl:apply-templates/>
													</xsl:for-each>
												</td>
											</tr>
											<tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Senaryo:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:ProfileID">
														<xsl:apply-templates/>
													</xsl:for-each>
												</td>
											</tr>
											<tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Fatura Tipi:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:InvoiceTypeCode">
														<xsl:apply-templates/>
													</xsl:for-each>
												</td>
											</tr>
											<tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Fatura No:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:ID">
														<xsl:apply-templates/>
													</xsl:for-each>
												</td>
											</tr>
											<tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Fatura Tarihi:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:IssueDate">
														<xsl:apply-templates select="."/>
													</xsl:for-each>
												</td>
											</tr>
                                            <tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Düzenleme Tarihi:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:IssueDate">
														<xsl:apply-templates select="."/>
													</xsl:for-each>
												</td>
											</tr>
											<tr style="height:13px; ">
												<td align="left">
													<span style="font-weight:bold; ">
														<xsl:text>Düzenleme Zamanı:</xsl:text>
													</span>
												</td>
												<td align="left">
													<xsl:for-each select="n1:Invoice/cbc:IssueTime">
														<xsl:apply-templates select="."/>
													</xsl:for-each>
												</td>
											</tr>
											<xsl:for-each select="n1:Invoice/cac:DespatchDocumentReference">
												<tr style="height:13px; ">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>İrsaliye No:</xsl:text>
														</span>
														<xsl:text>&#160;</xsl:text>
													</td>
													<td align="left">
														<xsl:value-of select="cbc:ID"/>
													</td>
												</tr>
												<tr style="height:13px; ">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>İrsaliye Tarihi:</xsl:text>
														</span>
													</td>
													<td align="left">
														<xsl:for-each select="cbc:IssueDate">
															<xsl:apply-templates select="."/>
														</xsl:for-each>
													</td>
												</tr>
											</xsl:for-each>
											<xsl:if test="//n1:Invoice/cac:OrderReference">
												<tr style="height:13px">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Sipariş No:</xsl:text>
														</span>
													</td>
													<td align="left">
														<xsl:for-each select="n1:Invoice/cac:OrderReference/cbc:ID">
															<xsl:apply-templates/>
														</xsl:for-each>
													</td>
												</tr>
											</xsl:if>
											<xsl:if	test="//n1:Invoice/cac:OrderReference/cbc:IssueDate">
												<tr style="height:13px">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Sipariş Tarihi:</xsl:text>
														</span>
													</td>
													<td align="left">
														<xsl:for-each select="n1:Invoice/cac:OrderReference/cbc:IssueDate">
															<xsl:apply-templates select="."/>
														</xsl:for-each>
													</td>
												</tr>
											</xsl:if>
											<xsl:for-each select="n1:Invoice/cac:TaxRepresentativeParty/cac:PartyIdentification/cbc:ID[@schemeID='ARACIKURUMVKN']">
												<tr>
													<td style="width:105px;" align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Aracı Kurum VKN:</xsl:text>
														</span>
													</td>
													<td style="width:110px;" align="left">
														<xsl:value-of select="."/>
													</td>
												</tr>
												<tr>
													<td style="width:105px;" align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Aracı Kurum Unvan:</xsl:text>
														</span>
													</td>
													<td style="width:110px;" align="left">
														<xsl:value-of select="../../cac:PartyName/cbc:Name"/>
													</td>
												</tr>
											</xsl:for-each>
											<xsl:if test="//n1:Invoice/cac:PaymentMeans/cbc:PaymentDueDate">
												<tr style="height:13px">
													<td align="left">
														<span style="font-weight:bold; ">
															<xsl:text>Son Ödeme Tarihi</xsl:text>
														</span>
													</td>
													<td align="left">
														<xsl:value-of select="substring(//n1:Invoice/cac:PaymentMeans/cbc:PaymentDueDate,9,2)"/>-<xsl:value-of select="substring(//n1:Invoice/cac:PaymentMeans/cbc:PaymentDueDate,6,2)"/>-<xsl:value-of select="substring(//n1:Invoice/cac:PaymentMeans/cbc:PaymentDueDate,1,4)"/>
													</td>
												</tr>
											</xsl:if>
										</tbody>
									</table>
								</td>
							</tr>
							</xsl:if>
							<xsl:choose>
							  <xsl:when test="n1:Invoice/cbc:InvoiceTypeCode ='SGK' ">
								<tr align="left">
								  <table style="border-collapse: collapse">
									<tr>
									  <td align="left" style=" border: 1px solid black; ">
										<span style="font-weight:bold; ">
										  <xsl:text>Sağlık Fatura Tipi:</xsl:text>
										</span>
									  </td>
									  <td align="left" style=" border: 1px solid black; ">
										<xsl:for-each select="n1:Invoice/cbc:AccountingCost">
										  <xsl:apply-templates />
										</xsl:for-each>
									  </td>
									</tr>
									<tr>
									  <td align="left" style=" border: 1px solid black; ">
										<span style="font-weight:bold; ">
										  <xsl:text>Mükellef Kodu:</xsl:text>
										</span>
									  </td>
									  <td align="left" style=" border: 1px solid black; ">
										<xsl:for-each select="n1:Invoice/cac:AdditionalDocumentReference">
										  <xsl:choose>
											<xsl:when test="cbc:DocumentTypeCode='MUKELLEF_KODU' ">
											  <xsl:value-of select="cbc:DocumentType" />
											</xsl:when>
										  </xsl:choose>
										</xsl:for-each>
									  </td>
									</tr>
									<tr>
									  <td align="left" style=" border: 1px solid black; ">
										<span style="font-weight:bold; ">
										  <xsl:text>Mükellef Adı:</xsl:text>
										</span>
									  </td>
									  <td align="left" style=" border: 1px solid black; ">
										<xsl:for-each select="n1:Invoice/cac:AdditionalDocumentReference">
										  <xsl:choose>
											<xsl:when test="cbc:DocumentTypeCode='MUKELLEF_ADI' ">
											  <xsl:value-of select="cbc:DocumentType" />
											</xsl:when>
										  </xsl:choose>
										</xsl:for-each>
									  </td>
									</tr>
									<tr>
									  <td align="left" style=" border: 1px solid black; ">
										<span style="font-weight:bold; ">
										  <xsl:text>Dosya No:</xsl:text>
										</span>
									  </td>
									  <td align="left" style=" border: 1px solid black; ">
										<xsl:for-each select="n1:Invoice/cac:AdditionalDocumentReference">
										  <xsl:choose>
											<xsl:when test="cbc:DocumentTypeCode='DOSYA_NO' ">
											  <xsl:value-of select="cbc:DocumentType" />
											</xsl:when>
										  </xsl:choose>
										</xsl:for-each>
									  </td>
									</tr>
									<tr>
									  <td align="left" style=" border: 1px solid black; ">
										<span style="font-weight:bold; ">
										  <xsl:text>Dönem:</xsl:text>
										</span>
									  </td>
									  <td align="left" style=" border: 1px solid black; ">
										<xsl:for-each select="n1:Invoice/cac:InvoicePeriod">
										  <xsl:value-of select="cbc:StartDate" />
										  <xsl:text> / </xsl:text>
										  <xsl:value-of select="cbc:EndDate" />
										</xsl:for-each>
									  </td>
									</tr>
								  </table>
								</tr>
							  </xsl:when>
							</xsl:choose>
							<tr align="left">
								<table id="ettnTable">
									<tr style="height:13px;">
										<td align="left" valign="top">
											<span style="font-weight:bold; ">
												<xsl:text>ETTN:</xsl:text>
											</span>
										</td>
										<td align="left" width="240px">
											<xsl:for-each select="n1:Invoice/cbc:UUID">
												<xsl:apply-templates/>
											</xsl:for-each>
										</td>
									</tr>
								</table>
							</tr>
						</tbody>
					</table>
					<div id="lineTableAligner">
						<span>
							<xsl:text>&#160;</xsl:text>
						</span>
					</div>
					<table border="1" id="lineTable" width="800">
						<tbody>
							<tr id="lineTableTr">
								<td id="lineTableTd" style="width:3%">
									<span style="font-weight:bold; " align="center">
										<xsl:text>Sıra No</xsl:text>
									</span>
								</td>
								<xsl:if test="//n1:Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='VKN']='2940035696'">
									<td class="lineTableTd" style="width:10%" align="center">
										<span style="font-weight:bold; ">
											<xsl:text>DMO Ürün Kodu</xsl:text>
										</span>
									</td>
								</xsl:if>
								<td id="lineTableTd" style="width:14%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>Mal Hizmet</xsl:text>
									</span>
								</td>
								<td id="lineTableTd" style="width:14%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>Açıklama</xsl:text>
									</span>
								</td>
								<td id="lineTableTd" style="width:7.4%" align="center">
									<span style="font-weight:bold;">
										<xsl:text>Miktar</xsl:text>
									</span>
								</td>
								<td id="lineTableTd" style="width:8%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>Birim Fiyat</xsl:text>
									</span>
								</td>
								<td id="lineTableTd" style="width:7%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>İskonto Oranı</xsl:text>
									</span>
								</td>
								<td id="lineTableTd" style="width:7%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>İskonto Tutarı</xsl:text>
									</span>
								</td>
								<td id="lineTableTd" style="width:7%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>KDV Oranı</xsl:text>
									</span>
								</td>
								<td id="lineTableTd" style="width:7%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>KDV Tutarı</xsl:text>
									</span>
								</td>
								<td id="lineTableTd" style="width:15%; " align="center">
									<span style="font-weight:bold; ">
										<xsl:text>Diğer Vergiler</xsl:text>
									</span>
								</td>
								<td id="lineTableTd" style="width:10.6%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>Mal Hizmet Tutarı</xsl:text>
									</span>
								</td>
								<xsl:if
									test="//n1:Invoice/cbc:ProfileID='HKS'">
									<td class="lineTableTd" style="width:5%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>Künye Numarası</xsl:text>
										</span>
									</td>
								</xsl:if>
								<xsl:if
									test="//n1:Invoice/cbc:ProfileID='HKS' and /n1:Invoice/cbc:InvoiceTypeCode='SATIS'">
									<td class="lineTableTd" style="width:5%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>Mal Sahibi VKN/TCKN</xsl:text>
										</span>
									</td>
									<td class="lineTableTd" style="width:5%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>Mal Sahibi Ad/Soyad</xsl:text>
										</span>
									</td>
								</xsl:if>
								<xsl:if test="//n1:Invoice/cbc:ProfileID='IHRACAT'">
									<td class="lineTableTd" style="width:10.6%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>Teslim Şartı</xsl:text>
										</span>
									</td>
									<td class="lineTableTd" style="width:10.6%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>Eşya Kap Cinsi</xsl:text>
										</span>
									</td>
									<td class="lineTableTd" style="width:10.6%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>Kap No</xsl:text>
										</span>
									</td>
									<td class="lineTableTd" style="width:10.6%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>Kap Adet</xsl:text>
										</span>
									</td>
									<td class="lineTableTd" style="width:10.6%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>Teslim/Bedel Ödeme Yeri</xsl:text>
										</span>
									</td>
									<td class="lineTableTd" style="width:10.6%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>Gönderilme Şekli</xsl:text>
										</span>
									</td>
									<td class="lineTableTd" style="width:10.6%" align="center">
										<span style="font-weight:bold;">
											<xsl:text>GTİP</xsl:text>
										</span>
									</td>
								</xsl:if>
							</tr>
							<xsl:if test="count(//n1:Invoice/cac:InvoiceLine) &gt;= 0">
								<xsl:for-each select="//n1:Invoice/cac:InvoiceLine">
									<xsl:apply-templates select="."/>
								</xsl:for-each>
							</xsl:if>
						</tbody>
					</table>
				</xsl:for-each>
				<br/>
				
				<table id="budgetContainerTable" table-layout="fixed" width="800px">
					<tbody>
						<tr>
						<xsl:if
						test="//n1:Invoice/cbc:ProfileID='HKS' and //n1:Invoice/cbc:InvoiceTypeCode='KOMISYONCU'">
							<td align="left" valign="top" width="300px">
							<table>
								<tbody>							
								<xsl:for-each select="n1:Invoice/cac:AllowanceCharge">
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSKOMISYON'">
										<tr align="left" border="0">
												<td align="left" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Masraflar:</xsl:text>
													</span>
												</td>

										</tr>
										<tr align="left">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Komisyon - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSKOMISYONKDV'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Komisyon KDV - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSNAVLUN'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Navlun - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSNAVLUNKDV'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Navlun KDV - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSHAMMALIYE'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Hammaliye - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSHAMMALIYEKDV'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Hammaliye KDV - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSNAKLIYE'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Nakliye - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSNAKLIYEKDV'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Nakliye KDV - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>	
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSGVTEVKIFAT'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>G.V. Tevkifat - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSBAGKURTEVKIFAT'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Bağkur Tevkifat - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSRUSUM'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Rüsum - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSRUSUMKDV'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Rüsum KDV - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSTICBORSASI'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Ticaret Borsası - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSTICBORSASIKDV'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Ticaret Borsası KDV - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSMILLISAVUNMAFON'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Milli Savunma Fon - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSMSFONKDV'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Milli Savunma Fon KDV - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSDIGERMASRAFLAR'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Diğer Masraflar - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>
									<xsl:if test="cbc:AllowanceChargeReason = 'HKSDIGERKDV'">
										<tr align="right">
												<td class="lineTableBudgetTd" align="right" width="200px">
													<span style="font-weight:bold; ">
														<xsl:text>Diğer KDV - %</xsl:text>
													</span>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:Amount">
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
												<td class="lineTableBudgetTd" style="width:81px; " align="right">
													<xsl:for-each
														select="cbc:MultiplierFactorNumeric">
														<xsl:text> %</xsl:text>
														<xsl:call-template name="Curr_Type"/>
													</xsl:for-each>
												</td>
										</tr>
									</xsl:if>

								</xsl:for-each>
															
								</tbody>	
								</table>
							</td>
					</xsl:if>
					<td align="right" valign="top">
						<table>
						<tbody>
						<tr align="right">
							<td/>
							<td class="lineTableBudgetTd" align="right" width="200px">
								<span style="font-weight:bold; ">
									<xsl:text>Mal Hizmet Toplam Tutarı</xsl:text>
								</span>
							</td>
							<td class="lineTableBudgetTd" style="width:81px; " align="right">
								<xsl:for-each
									select="n1:Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount">
									<xsl:call-template name="Curr_Type"/>
								</xsl:for-each>
							</td>
						</tr>
						<xsl:for-each select="n1:Invoice/cac:TaxTotal/cac:TaxSubtotal">
							<xsl:if test="cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode = '4171'">
								<tr align="right">
									<td/>
									<td class="lineTableBudgetTd" align="right" width="200px">
										<span style="font-weight:bold; ">
											<xsl:text>Teslim Bedeli</xsl:text>
										</span>
									</td>
									<td class="lineTableBudgetTd" style="width:81px; " align="right">
										<xsl:for-each
											select="//n1:Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount">
											<xsl:call-template name="Curr_Type"/>
										</xsl:for-each>
									</td>
								</tr>
							</xsl:if>
						</xsl:for-each>
						<tr align="right">
							<td/>
							<xsl:choose>
								<xsl:when
									test="//n1:Invoice/cac:AllowanceCharge/cbc:ChargeIndicator='true'">
									<td class="lineTableBudgetTd" align="right" width="200px">
										<span style="font-weight:bold; ">
											<xsl:text>Toplam Arttırım - </xsl:text>
											<xsl:for-each
												select="n1:Invoice/cac:AllowanceCharge/cbc:AllowanceChargeReason">
												<xsl:apply-templates/>
											</xsl:for-each>
										</span>
									</td>
								</xsl:when>
								<xsl:otherwise>
									<td class="lineTableBudgetTd" align="right" width="200px">
										<span style="font-weight:bold; ">
											<xsl:text>Toplam İskonto</xsl:text>
										</span>
									</td>
								</xsl:otherwise>
							</xsl:choose>
							<td class="lineTableBudgetTd" style="width:81px; " align="right">
								<xsl:for-each
									select="n1:Invoice/cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount">
									<xsl:call-template name="Curr_Type"/>
								</xsl:for-each>
							</td>
						</tr>
						<xsl:for-each select="n1:Invoice">
						<xsl:for-each select="cac:TaxTotal">
							<xsl:for-each select="cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme">
								<xsl:if test="cbc:TaxTypeCode='0015' ">
									<xsl:if test="//n1:Invoice/cbc:ProfileID!='IHRACAT'">
										<tr align="right">
											<td/>
											<td class="lineTableBudgetTd" width="200px" align="right">
												<span style="font-weight:bold; ">
													<xsl:text>KDV Matrahı</xsl:text>
													<xsl:if test ="$VATCount > 1">
														<xsl:text> %</xsl:text>
														<xsl:value-of select="../../cbc:Percent"/>
													</xsl:if>
												</span>
											</td>
											<td class="lineTableBudgetTd" style="width:82px; " align="right">
												<xsl:text> </xsl:text>
												<xsl:value-of select="format-number(../../cbc:TaxableAmount, '###.##0,00', 'european')"/>
												<xsl:if test="../../cbc:TaxableAmount/@currencyID">
													<xsl:text> </xsl:text>
													<xsl:if test="../../cbc:TaxableAmount/@currencyID = 'TRY'">
														<xsl:text>TL</xsl:text>
													</xsl:if>
													<xsl:if test="../../cbc:TaxableAmount/@currencyID != 'TRY'">
														<xsl:value-of select="../../cbc:TaxableAmount/@currencyID"/>
													</xsl:if>
												</xsl:if>
											</td>
										</tr>
									</xsl:if>
								</xsl:if>
							</xsl:for-each>
						</xsl:for-each>
						</xsl:for-each>
						<xsl:for-each select="n1:Invoice/cac:TaxTotal/cac:TaxSubtotal">
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="211px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Hesaplanan </xsl:text>
										<xsl:value-of select="cac:TaxCategory/cac:TaxScheme/cbc:Name"/>
										<xsl:text>(%</xsl:text>
										<xsl:value-of select="cbc:Percent"/>
										<xsl:text>)</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:for-each select="cac:TaxCategory/cac:TaxScheme">
											<xsl:text> </xsl:text>
											<xsl:value-of
												select="format-number(../../cbc:TaxAmount, '###.##0,00', 'european')"/>
											<xsl:if test="../../cbc:TaxAmount/@currencyID">
												<xsl:text> </xsl:text>
												<xsl:if
													test="../../cbc:TaxAmount/@currencyID = 'TRL' or ../../cbc:TaxAmount/@currencyID = 'TRY'">
													<xsl:text>TL</xsl:text>
												</xsl:if>
												<xsl:if
													test="../../cbc:TaxAmount/@currencyID != 'TRL' and ../../cbc:TaxAmount/@currencyID != 'TRY'">
													<xsl:value-of
													select="../../cbc:TaxAmount/@currencyID"/>
												</xsl:if>
											</xsl:if>
									</xsl:for-each>
								</td>
							</tr>
						</xsl:for-each>
						<xsl:for-each select="n1:Invoice/cac:TaxTotal/cac:TaxSubtotal">
							<xsl:if test="cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode = '4171'">
								<tr align="right">
									<td/>
									<td class="lineTableBudgetTd" align="right" width="200px">
										<span style="font-weight:bold; ">
											<xsl:text>KDV Matrahı</xsl:text>
										</span>
									</td>
									<td class="lineTableBudgetTd" style="width:81px; " align="right">
										<xsl:value-of
											select="format-number(sum(//n1:Invoice/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=0015]/cbc:TaxableAmount), '###.##0,00', 'european')"/>
										<xsl:if
											test="//n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount/@currencyID">
											<xsl:text> </xsl:text>
											<xsl:if
												test="//n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount/@currencyID = 'TRL' or //n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount/@currencyID = 'TRY'">
												<xsl:text>TL</xsl:text>
											</xsl:if>
											<xsl:if
												test="//n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount/@currencyID != 'TRL' and //n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount/@currencyID != 'TRY'">
												<xsl:value-of
													select="//n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount/@currencyID"
												/>
											</xsl:if>
										</xsl:if>
									</td>
								</tr>
								<tr align="right">
									<td/>
									<td class="lineTableBudgetTd" align="right" width="200px">
										<span style="font-weight:bold; ">
											<xsl:text>Tevkifat Dahil Toplam Tutar</xsl:text>
										</span>
									</td>
									<td class="lineTableBudgetTd" style="width:81px; " align="right">
										<xsl:for-each
											select="//n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount">
											<xsl:call-template name="Curr_Type"/>
										</xsl:for-each>
									</td>
								</tr>
								<tr align="right">
									<td/>
									<td class="lineTableBudgetTd" align="right" width="200px">
										<span style="font-weight:bold; ">
											<xsl:text>Tevkifat Hariç Toplam Tutar</xsl:text>
										</span>
									</td>
									<td class="lineTableBudgetTd" style="width:81px; " align="right">
										<xsl:for-each
											select="//n1:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount">
											<xsl:call-template name="Curr_Type"/>
										</xsl:for-each>
									</td>
								</tr>
							</xsl:if>
						</xsl:for-each>
						<xsl:for-each select="n1:Invoice/cac:WithholdingTaxTotal/cac:TaxSubtotal">
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="211px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Hesaplanan KDV Tevkifat</xsl:text>
										<xsl:text>(%</xsl:text>
										<xsl:value-of select="cbc:Percent"/>
										<xsl:text>)</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:for-each select="cac:TaxCategory/cac:TaxScheme">
										<xsl:text> </xsl:text>
										<xsl:value-of
											select="format-number(../../cbc:TaxAmount, '###.##0,00', 'european')"/>
										<xsl:if test="../../cbc:TaxAmount/@currencyID">
											<xsl:text> </xsl:text>
											<xsl:if
												test="../../cbc:TaxAmount/@currencyID = 'TRL' or ../../cbc:TaxAmount/@currencyID = 'TRY'">
												<xsl:text>TL</xsl:text>
											</xsl:if>
											<xsl:if
												test="../../cbc:TaxAmount/@currencyID != 'TRL' and ../../cbc:TaxAmount/@currencyID != 'TRY'">
												<xsl:value-of select="../../cbc:TaxAmount/@currencyID"/>
											</xsl:if>
										</xsl:if>
									</xsl:for-each>
								</td>
							</tr>
						</xsl:for-each>
						<xsl:if
							test="sum(n1:Invoice/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=9015]/cbc:TaxableAmount)>0">
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="211px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Tevkifata Tabi İşlem Tutarı</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:value-of
										select="format-number(sum(n1:Invoice/cac:InvoiceLine[cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=9015]/cbc:LineExtensionAmount), '###.##0,00', 'european')"/>
									<xsl:if test="n1:Invoice/cbc:DocumentCurrencyCode = 'TRL'">
										<xsl:text>TL</xsl:text>
									</xsl:if>
									<xsl:if test="n1:Invoice/cbc:DocumentCurrencyCode != 'TRL'">
										<xsl:value-of select="n1:Invoice/cbc:DocumentCurrencyCode"/>
									</xsl:if>
								</td>
							</tr>
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="211px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Tevkifata Tabi İşlem Üzerinden Hes. KDV</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:value-of
										select="format-number(sum(n1:Invoice/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=9015]/cbc:TaxableAmount), '###.##0,00', 'european')"/>
									<xsl:if test="n1:Invoice/cbc:DocumentCurrencyCode = 'TRL'">
										<xsl:text>TL</xsl:text>
									</xsl:if>
									<xsl:if test="n1:Invoice/cbc:DocumentCurrencyCode != 'TRL'">
										<xsl:value-of select="n1:Invoice/cbc:DocumentCurrencyCode"/>
									</xsl:if>
								</td>
							</tr>
						</xsl:if>
						<xsl:if
							test="n1:Invoice/cac:InvoiceLine[cac:WithholdingTaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme]">
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="211px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Tevkifata Tabi İşlem Tutarı</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:if
										test="n1:Invoice/cac:InvoiceLine[cac:WithholdingTaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme]">
										<xsl:value-of
											select="format-number(sum(n1:Invoice/cac:InvoiceLine[cac:WithholdingTaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme]/cbc:LineExtensionAmount), '###.##0,00', 'european')"
										/>
									</xsl:if>
									<xsl:if
										test="//n1:Invoice/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=&apos;9015&apos;">
										<xsl:value-of
											select="format-number(sum(n1:Invoice/cac:InvoiceLine[cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=9015]/cbc:LineExtensionAmount), '###.##0,00', 'european')"
										/>
									</xsl:if>
									<xsl:if
										test="n1:Invoice/cbc:DocumentCurrencyCode = 'TRL' or n1:Invoice/cbc:DocumentCurrencyCode = 'TRY'">
										<xsl:text>TL</xsl:text>
									</xsl:if>
									<xsl:if
										test="n1:Invoice/cbc:DocumentCurrencyCode != 'TRL' and n1:Invoice/cbc:DocumentCurrencyCode != 'TRY'">
										<xsl:value-of select="n1:Invoice/cbc:DocumentCurrencyCode"/>
									</xsl:if>
								</td>
							</tr>
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="211px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Tevkifata Tabi İşlem Üzerinden Hes. KDV</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:if
										test="n1:Invoice/cac:InvoiceLine[cac:WithholdingTaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme]">
										<xsl:value-of
											select="format-number(sum(n1:Invoice/cac:WithholdingTaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme]/cbc:TaxableAmount), '###.##0,00', 'european')"
										/>
									</xsl:if>
									<xsl:if
										test="//n1:Invoice/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=&apos;9015&apos;">
										<xsl:value-of
											select="format-number(sum(n1:Invoice/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=9015]/cbc:TaxableAmount), '###.##0,00', 'european')"
										/>
									</xsl:if>
									<xsl:if
										test="n1:Invoice/cbc:DocumentCurrencyCode = 'TRL' or n1:Invoice/cbc:DocumentCurrencyCode = 'TRY'">
										<xsl:text>TL</xsl:text>
									</xsl:if>
									<xsl:if
										test="n1:Invoice/cbc:DocumentCurrencyCode != 'TRL' and n1:Invoice/cbc:DocumentCurrencyCode != 'TRY'">
										<xsl:value-of select="n1:Invoice/cbc:DocumentCurrencyCode"/>
									</xsl:if>
								</td>
							</tr>
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="200px" align="right">
								<span style="font-weight:bold; ">
									<xsl:text>Ödenecek KDV</xsl:text>
								</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:if test = "//n1:Invoice/cac:WithholdingTaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme]">
										<xsl:value-of
								select="format-number( (sum(n1:Invoice/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=0015]/cbc:TaxAmount) - sum(n1:Invoice/cac:WithholdingTaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme]/cbc:TaxAmount) ), '###.##0,00', 'european')"/>
									</xsl:if>
									<xsl:if test = "//n1:Invoice/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=9015]">
										<xsl:value-of
								select="format-number(sum(n1:Invoice/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=0015]/cbc:TaxAmount) - sum(n1:Invoice/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode=9015]/cbc:TaxAmount), '###.##0,00', 'european')"/>
									</xsl:if>
									<xsl:if test="n1:Invoice/cbc:DocumentCurrencyCode = 'TRL' or n1:Invoice/cbc:DocumentCurrencyCode = 'TRY'">
										<xsl:text>TL</xsl:text>
									</xsl:if>
									<xsl:if test="n1:Invoice/cbc:DocumentCurrencyCode != 'TRL' and n1:Invoice/cbc:DocumentCurrencyCode != 'TRY'">
										<xsl:value-of select="n1:Invoice/cbc:DocumentCurrencyCode"/>
									</xsl:if>
								</td>
							</tr>
						</xsl:if>
						<tr align="right">
							<td/>
							<td class="lineTableBudgetTd" width="200px" align="right">
								<span style="font-weight:bold; ">
									<xsl:text>Vergiler Dahil Toplam Tutar</xsl:text>
								</span>
							</td>
							<td class="lineTableBudgetTd" style="width:82px; " align="right">
								<xsl:for-each
									select="n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount">
									<xsl:call-template name="Curr_Type"/>
								</xsl:for-each>
							</td>
						</tr>
						<xsl:if
							test="//n1:Invoice/cbc:ProfileID='HKS' and //n1:Invoice/cbc:InvoiceTypeCode='KOMISYONCU'">
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="200px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Toplam Masraflar</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:for-each
										select="n1:Invoice/cac:LegalMonetaryTotal/cbc:ChargeTotalAmount">
										<xsl:call-template name="Curr_Type"/>
									</xsl:for-each>
								</td>
							</tr>
						</xsl:if>
						<tr align="right">
							<td/>
							<td class="lineTableBudgetTd" width="200px" align="right">
								<span style="font-weight:bold; ">
									<xsl:text>Ödenecek Tutar</xsl:text>
								</span>
							</td>
							<td class="lineTableBudgetTd" style="width:82px; " align="right">
								<xsl:for-each
									select="n1:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount">
									<xsl:call-template name="Curr_Type"/>
								</xsl:for-each>
							</td>
						</tr>
						<xsl:for-each
							select="n1:Invoice/cac:Delivery/cac:Shipment/cbc:DeclaredCustomsValueAmount">
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="200px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Toplam Byn. Edl. Kıymet Değeri</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:call-template name="Curr_Type"/>
								</td>
							</tr>
						</xsl:for-each>
						<xsl:for-each select="n1:Invoice/cac:TaxTotal/cac:TaxSubtotal">
							<xsl:if
								test="//n1:Invoice/cbc:DocumentCurrencyCode != 'TRY' and //n1:Invoice/cbc:DocumentCurrencyCode != 'TRL'">
								<tr align="right">
									<td/>
									<td class="lineTableBudgetTd" align="right" width="200px">
										<span style="font-weight:bold; ">
											<xsl:text>Hesaplanan </xsl:text>
											<xsl:value-of
												select="cac:TaxCategory/cac:TaxScheme/cbc:Name"/>
											<xsl:text>(%</xsl:text>
											<xsl:value-of select="cbc:Percent"/>
											<xsl:text>) (TL)</xsl:text>
										</span>
									</td>
									<td class="lineTableBudgetTd" style="width:81px; " align="right">
										<span>
											<xsl:value-of
												select="format-number(cbc:TaxAmount * //n1:Invoice/cac:PricingExchangeRate/cbc:CalculationRate, '###.##0,00', 'european')"/>
											<xsl:text> TL</xsl:text>
										</span>
									</td>
								</tr>
							</xsl:if>
						</xsl:for-each>
						<xsl:if
							test="//n1:Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount/@currencyID != 'TRL' and //n1:Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount/@currencyID != 'TRY'">
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" align="right" width="200px">
									<span style="font-weight:bold; ">
										<xsl:text>Mal Hizmet Toplam Tutarı(TL)</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:81px; " align="right">
									<xsl:value-of
										select="format-number(//n1:Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount * //n1:Invoice/cac:PricingExchangeRate/cbc:CalculationRate, '###.##0,00', 'european')"/>
									<xsl:text> TL</xsl:text>
								</td>
							</tr>
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="200px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Vergiler Dahil Toplam Tutar(TL)</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:value-of
										select="format-number(//n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount * //n1:Invoice/cac:PricingExchangeRate/cbc:CalculationRate, '###.##0,00', 'european')"/>
									<xsl:text> TL</xsl:text>
								</td>
							</tr>
							<tr align="right">
								<td/>
								<td class="lineTableBudgetTd" width="200px" align="right">
									<span style="font-weight:bold; ">
										<xsl:text>Ödenecek Tutar(TL)</xsl:text>
									</span>
								</td>
								<td class="lineTableBudgetTd" style="width:82px; " align="right">
									<xsl:value-of
										select="format-number(//n1:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount * //n1:Invoice/cac:PricingExchangeRate/cbc:CalculationRate, '###.##0,00', 'european')"/>
									<xsl:text> TL</xsl:text>
								</td>
							</tr>
						</xsl:if>					
						</tbody>
						</table>
					</td>
						</tr>
					</tbody>
				</table>
				<br/>
				<table id="notesTable" width="800px">
					<tbody>
						<tr align="left">
							<td id="notesTableTd">
								<xsl:for-each select="//n1:Invoice/cac:TaxTotal/cac:TaxSubtotal">
									<xsl:if	test="(cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode='0015' or ../../cbc:InvoiceTypeCode='OZELMATRAH') and cac:TaxCategory/cbc:TaxExemptionReason">
										
											<b>&#160;&#160;&#160;&#160;&#160; Vergi İstisna Muafiyet Sebebi: </b>
											<xsl:value-of select="cac:TaxCategory/cbc:TaxExemptionReasonCode"/>
											<xsl:text>-</xsl:text>
											<xsl:value-of select="cac:TaxCategory/cbc:TaxExemptionReason"/>
											
											<br/>
										
									</xsl:if>
									<xsl:if	test="starts-with(cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode,'007') or cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode='9077' and cac:TaxCategory/cbc:TaxExemptionReason">
										 <xsl:if test="cbc:TaxAmount[@currencyID='TRY']='0.00'">
											<b>&#160;&#160;&#160;&#160;&#160; ÖTV İstisna Muafiyet Sebebi: </b>
											<xsl:value-of select="cac:TaxCategory/cbc:TaxExemptionReasonCode"/>
											<xsl:text>-</xsl:text>
											<xsl:value-of select="cac:TaxCategory/cbc:TaxExemptionReason"/>
											<br/>
										</xsl:if>
									</xsl:if>
								</xsl:for-each>
								<xsl:for-each select="//n1:Invoice/cac:WithholdingTaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme">
									<b>&#160;&#160;&#160;&#160;&#160; Tevkifat Sebebi: </b>
									<xsl:value-of select="cbc:TaxTypeCode"/>
									<xsl:text>-</xsl:text>
									<xsl:value-of select="cbc:Name"/>
									<br/>
								</xsl:for-each>
								<xsl:for-each select="//n1:Invoice/cbc:Note">
									<b>&#160;&#160;&#160;&#160;&#160; Not: </b>
									<xsl:value-of select="."/>
									<br/>
								</xsl:for-each>
								<xsl:if test="//n1:Invoice/cac:PaymentMeans/cbc:InstructionNote">
									<b>
										&#160;&#160;&#160;&#160;&#160; Ödeme Notu: </b>
									<xsl:value-of
										select="//n1:Invoice/cac:PaymentMeans/cbc:InstructionNote"/>
									<br/>
								</xsl:if>
								<!--<xsl:if
									test="//n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:PaymentNote">
									<b>
										&#160;&#160;&#160;&#160;&#160; Hesap
										Açıklaması:
									</b>
									<xsl:value-of
										select="//n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:PaymentNote"/>
									<br/>
								</xsl:if>-->
								<xsl:if test="//n1:Invoice/cac:PaymentTerms/cbc:Note">
									<b>
										&#160;&#160;&#160;&#160;&#160; Ödeme Koşulu: </b>
									<xsl:value-of select="//n1:Invoice/cac:PaymentTerms/cbc:Note"/>
									<br/>
								</xsl:if>
								<xsl:if test="//n1:Invoice/cac:BillingReference/cac:InvoiceDocumentReference[cbc:DocumentTypeCode='İADE']">
									<b>
										&#160;&#160;&#160;&#160;&#160; İade Sebebi: </b>
									<xsl:value-of select="//n1:Invoice/cac:BillingReference/cac:InvoiceDocumentReference[cbc:DocumentTypeCode='İADE']/cbc:DocumentType"/>
									<br/>
								</xsl:if>
								<xsl:if test="//n1:Invoice/cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='PARTYTYPE']='TAXFREE' and //n1:Invoice/cac:TaxRepresentativeParty/cac:PartyTaxScheme/cbc:ExemptionReasonCode">
									<br/>
									<b>&#160;&#160;&#160;&#160;&#160; VAT OFF - NO CASH REFUND </b>
								</xsl:if>
							</td>
						</tr>
					</tbody>
				</table>
				<br/>
				<xsl:if test="//n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount">
					<table id="accountTable" width="800" border="1">
						<tbody>
							<tr>
								<td colspan="3" align="center">
									<span style="font-weight:bold; font-size:small" align="center">
										<xsl:text>Ödeme Bilgileri</xsl:text>
									</span>
								</td>
							</tr>
							<tr id="accountTableTr">
								<td id="accountTableTd" style="width:30%">
									<span style="font-weight:bold; " align="center">
										<xsl:text>Hesap Numarası</xsl:text>
									</span>
								</td>
								<td id="accountTableTd" style="width:20%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>Para Birimi</xsl:text>
									</span>
								</td>
								<td id="accountTableTd" style="width:50%" align="center">
									<span style="font-weight:bold; ">
										<xsl:text>Açıklama</xsl:text>
									</span>
								</td>
							</tr>
							<xsl:if test="count(//n1:Invoice/cac:PaymentMeans) &gt;= 0">
								<xsl:for-each select="//n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount">
									<xsl:apply-templates select="."/>
								</xsl:for-each>
							</xsl:if>
						</tbody>
					</table>
				</xsl:if>
			</body>
		</html>
	</xsl:template>
	<xsl:template match="//n1:Invoice/cac:InvoiceLine">
		<tr id="lineTableTr">
			<td id="lineTableTd">
				<xsl:text>&#160;</xsl:text>
				<xsl:value-of select="./cbc:ID"/>
			</td>
			<xsl:if test="//n1:Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID='VKN']='2940035696'">
				<td class="lineTableTd" align="center">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each
						select="cac:Item/cac:BuyersItemIdentification/cbc:ID">
						<xsl:text>&#160;</xsl:text>
						<xsl:apply-templates/>
					</xsl:for-each>
				</td>
			</xsl:if>
			<td id="lineTableTd">
				<xsl:text>&#160;</xsl:text>
				<xsl:value-of select="./cac:Item/cbc:Name"/>
			</td>
			<td id="lineTableTd">
				<span>
					<xsl:text>&#160;</xsl:text>
					<xsl:value-of select="./cbc:Note"/>
				</span>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
				<xsl:value-of
					select="format-number(./cbc:InvoicedQuantity, '###.##0,####', 'european')"/>
				<xsl:if test="./cbc:InvoicedQuantity/@unitCode">
					<xsl:for-each select="./cbc:InvoicedQuantity">
						<xsl:text/>
						<xsl:choose>
							<xsl:when test="@unitCode  = 'KSD'">
								<xsl:text> %90 Kuru Ürün Kilogramı  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'A1'">
								<xsl:text> 15 K Kalori</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'CPR'">
								<xsl:text> Adet -Çift</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'AFF'">
								<xsl:text> AFİF Birim Fiyatı</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'AYR'">
								<xsl:text> Altın Ayarı</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'AKQ'">
								<xsl:text> ATV Birim Fiyatı</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KNI'">
								<xsl:text> Azotun Kilogramı  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'BAS'">
								<xsl:text> BAS</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'TWH'">
								<xsl:text> Bin Kilowatt Saat  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'C62'">
								<xsl:text> Bir</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'AD'">
								<xsl:text> Bit</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'SA'">
								<xsl:text> Çuval</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'DMT'">
								<xsl:text> Decimetre</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'DMK'">
								<xsl:text> Desimetre Kare</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'DMQ'">
								<xsl:text> Desimetre Küp</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KFO'">
								<xsl:text> Difosfor Pentoksit Kg</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'DZN'">
								<xsl:text> Düzine</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'DZP'">
								<xsl:text> Dozen Pack</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'DPR'">
								<xsl:text> Dozen Pair</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'DPC'">
								<xsl:text> Dozen Piece</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'CS'">
								<xsl:text> Kasa</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'GFI'">
								<xsl:text> Fissile İzotop Gramı</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = '10'">
								<xsl:text> Grup</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'GMS'">
								<xsl:text> Gümüş</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'EA'">
								<xsl:text> Her bir</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KHO'">
								<xsl:text> Hidrojen Peroksit Kilogramı</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'INH'">
								<xsl:text> İnç</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'NCR'">
								<xsl:text> Karat</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'CT'">
								<xsl:text> Karton</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KPH'">
								<xsl:text> KG Potasyum Hidroksit</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KW'">
								<xsl:text> Kg/mm</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'K62'">
								<xsl:text> Kilogram-Adet</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KH6'">
								<xsl:text> Kilogram-Baş</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KPR'">
								<xsl:text> Kilogram -Çift  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KOH'">
								<xsl:text> Kilogram Potasyum Hidroksit  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'K20'">
								<xsl:text> Kilogram Potasyum Oksit  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KWT'">
								<xsl:text> Kilowatt</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'NPL'">
								<xsl:text> Koli</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'K58'">
								<xsl:text> Kurutulmuş Net Ağırlıklı Kilogram  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KMA'">
								<xsl:text> Metil Aminlerin Kilogramı  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'LM'">
								<xsl:text> Metretül</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'TNE'">
								<xsl:text> Metrik Ton</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'NE'">
								<xsl:text> Net Litre</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'OTB'">
								<xsl:text> ÖTV Birim Fiyat  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'OMV'">
								<xsl:text> ÖTV Maktu Vergi  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'PK'">
								<xsl:text> Paket/Koli</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'D97'">
								<xsl:text> Palet</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'U2'">
								<xsl:text> Plaka</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'RO'">
								<xsl:text> Rulo</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'RU'">
								<xsl:text> Sefer</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = '2I'">
								<xsl:text> Sıcaklık / Saat</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'BTU'">
								<xsl:text> Sıcaklık Birimi</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KSH'">
								<xsl:text> Sodyum Hidroksit Kilogramı  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'T0'">
								<xsl:text> Telekom Hattı</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'BG'">
								<xsl:text> Torba</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KUR'">
								<xsl:text> Uranyum Kilogramı  </xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'H62'">
								<xsl:text> Yüz Adet</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = '26'">
								<xsl:text>ton</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'BX'">
								<xsl:text>Kutu</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'LTR'">
								<xsl:text>lt</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'NIU'">
								<xsl:text>Adet</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'FOT'">
								<xsl:text>Ayak</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'DMK'">
								<xsl:text>Desimetre Kare</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'LM'">
								<xsl:text>Metretül</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KGM'">
								<xsl:text>kg</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KJO'">
								<xsl:text>kJ</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'GRM'">
								<xsl:text>g</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'MGM'">
								<xsl:text>mg</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'NT'">
								<xsl:text>Net Ton</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'GT'">
								<xsl:text>Gross Ton</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'MTR'">
								<xsl:text>m</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'MMT'">
								<xsl:text>mm</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KTM'">
								<xsl:text>km</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'MLT'">
								<xsl:text>ml</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'MMQ'">
								<xsl:text>mm3</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'CLT'">
								<xsl:text>cl</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'CMK'">
								<xsl:text>cm2</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'CMQ'">
								<xsl:text>cm3</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'CMT'">
								<xsl:text>cm</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'MTK'">
								<xsl:text>m2</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'MTQ'">
								<xsl:text>m3</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'DAY'">
								<xsl:text> Gün</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'MON'">
								<xsl:text> Ay</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'PA'">
								<xsl:text> Paket</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KWH'">
								<xsl:text> KWH</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'ANN'">
								<xsl:text> Yıl</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'HUR'">
								<xsl:text> Saat</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'D61'">
								<xsl:text> Dakika</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'D62'">
								<xsl:text> Saniye</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'CCT'">
								<xsl:text> Ton baş.taşıma kap.</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'D30'">
								<xsl:text> Brüt kalori</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'D40'">
								<xsl:text> 1000 lt</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'LPA'">
								<xsl:text> saf alkol lt</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'B32'">
								<xsl:text> kg.m2</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'NCL'">
								<xsl:text> hücre adet</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'PR'">
								<xsl:text> Çift</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'R9'">
								<xsl:text> 1000 m3</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'SET'">
								<xsl:text> Set</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'T3'">
								<xsl:text> 1000 adet</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'NPL'">
								<xsl:text> Koli</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'KG'">
								<xsl:text> Kg</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'CTM'">
								<xsl:text> Karat</xsl:text>
							</xsl:when>
							<xsl:when test="@unitCode  = 'RU'">
								<xsl:text> Sefer</xsl:text>
							</xsl:when>
						    <xsl:when test="@unitCode  = 'TNE'">
							    <xsl:text> Metrik Ton</xsl:text>
						    </xsl:when>
							<xsl:when test="@unitCode  = 'BB'">
							    <xsl:text> Teneke</xsl:text>
						    </xsl:when>
							<xsl:when test="@unitCode  = 'RO'">
							    <xsl:text> Rulo</xsl:text>
						    </xsl:when>
							<xsl:when test="@unitCode  = 'MWH'">
							    <xsl:text> MegaWatt Saat</xsl:text>
						    </xsl:when>
						    <xsl:when test="@unitCode  = 'CH'">
							   <xsl:text> Container</xsl:text>
						    </xsl:when>
						    <xsl:when test="@unitCode  = 'ZP'">
							    <xsl:text> Sayfa</xsl:text>
						    </xsl:when>
							<xsl:when test="@unitCode = 'HAR'">
								<xsl:text> Hektar</xsl:text>
							</xsl:when>
						    <xsl:when test="@unitCode = 'DR'">
								<xsl:text> Bidon</xsl:text>
						    </xsl:when>
							<xsl:when test="@unitCode  = 'BLL'">
								<xsl:text> Varil</xsl:text>
							</xsl:when>	
						<xsl:when test="@unitCode = 'E53'">
							<xsl:text> Test</xsl:text>
						</xsl:when>
						<xsl:when test="@unitCode = 'ACR'">
							<xsl:text> Dönüm</xsl:text>
						</xsl:when>
						</xsl:choose>
					</xsl:for-each>
				</xsl:if>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
				<xsl:value-of
					select="format-number(./cac:Price/cbc:PriceAmount, '###.##0,########', 'european')"/>
				<xsl:if test="./cac:Price/cbc:PriceAmount/@currencyID">
					<xsl:text/>
					<xsl:if test="./cac:Price/cbc:PriceAmount/@currencyID = &quot;TRL&quot; or ./cac:Price/cbc:PriceAmount/@currencyID = &quot;TRY&quot;">
						<xsl:text>TL</xsl:text>
					</xsl:if>
					<xsl:if test="./cac:Price/cbc:PriceAmount/@currencyID != &quot;TRL&quot; and ./cac:Price/cbc:PriceAmount/@currencyID != &quot;TRY&quot;">
						<xsl:value-of select="./cac:Price/cbc:PriceAmount/@currencyID"/>
					</xsl:if>
				</xsl:if>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
				<xsl:choose>
				<xsl:when test="./cac:AllowanceCharge/cbc:MultiplierFactorNumeric">
				<xsl:text> %</xsl:text>
				<xsl:value-of select="format-number(./cac:AllowanceCharge/cbc:MultiplierFactorNumeric * 100, '###.##0,00', 'european')"/>
				</xsl:when>
					<xsl:otherwise>
						<xsl:text> %0</xsl:text>
					</xsl:otherwise>
				</xsl:choose>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
				<xsl:for-each select="cac:AllowanceCharge/cbc:Amount">
					<xsl:call-template name="Curr_Type"/>
				</xsl:for-each>
			</td>
			
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
				<xsl:for-each select="./cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme">
					<xsl:if test="cbc:TaxTypeCode='0015' ">
						<xsl:text/>
						<xsl:if test="../../cbc:Percent">
							<xsl:text> %</xsl:text>
							<xsl:value-of select="format-number(../../cbc:Percent, '###.##0,00', 'european')"/>
						</xsl:if>
					</xsl:if>
				</xsl:for-each>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
				<xsl:for-each
					select="./cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme">
					<xsl:if test="cbc:TaxTypeCode='0015' ">
						<xsl:text/>
						<xsl:for-each select="../../cbc:TaxAmount">
							<xsl:call-template name="Curr_Type"/>
						</xsl:for-each>
					</xsl:if>
				</xsl:for-each>
			</td>
			<td id="lineTableTd" style="font-size: xx-small" align="right">
				<xsl:text>&#160;</xsl:text>
				<xsl:for-each
					select="./cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme">
					<xsl:if test="cbc:TaxTypeCode!='0015' ">
						<xsl:text/>
						<xsl:value-of select="cbc:Name"/>
						<xsl:if test="../../cbc:Percent">
							<xsl:text> (%</xsl:text>
							<xsl:value-of
								select="format-number(../../cbc:Percent, '###.##0,00', 'european')"/>
							<xsl:text>)=</xsl:text>
						</xsl:if>
						<xsl:for-each select="../../cbc:TaxAmount">
							<xsl:call-template name="Curr_Type"/>
						</xsl:for-each>
					</xsl:if>
				</xsl:for-each>
				<xsl:for-each
					select="./cac:WithholdingTaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme">
					<xsl:text>KDV TEVKİFAT </xsl:text>
					<xsl:if test="../../cbc:Percent">
						<xsl:text> (%</xsl:text>
						<xsl:value-of
							select="format-number(../../cbc:Percent, '###.##0,00', 'european')"/>
						<xsl:text>)=</xsl:text>
					</xsl:if>
					<xsl:for-each select="../../cbc:TaxAmount">
						<xsl:call-template name="Curr_Type"/>
						<xsl:text>&#10;</xsl:text>
					</xsl:for-each>
				</xsl:for-each>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
				<xsl:for-each select="cbc:LineExtensionAmount">
					<xsl:call-template name="Curr_Type"/>
				</xsl:for-each>
			</td>
			<xsl:if
				test="//n1:Invoice/cbc:ProfileID='HKS'">
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each
						select="cac:Item/cac:AdditionalItemIdentification/cbc:ID[@schemeID='KUNYENO']">
						<xsl:text>&#160;</xsl:text>
						<xsl:apply-templates/>
					</xsl:for-each>
				</td>
			</xsl:if>
			<xsl:if
				test="//n1:Invoice/cbc:ProfileID='HKS' and /n1:Invoice/cbc:InvoiceTypeCode='SATIS'">
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each
						select="cac:Item/cac:AdditionalItemIdentification/cbc:ID[@schemeID='MALSAHIBIVKNTCKN']">
						<xsl:text>&#160;</xsl:text>
						<xsl:apply-templates/>
					</xsl:for-each>
				</td>				
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each
						select="cac:Item/cac:AdditionalItemIdentification/cbc:ID[@schemeID='MALSAHIBIADSOYADUNVAN']">
						<xsl:text>&#160;</xsl:text>
						<xsl:apply-templates/>
					</xsl:for-each>
				</td>
			</xsl:if>
			<xsl:if test="//n1:Invoice/cbc:ProfileID='IHRACAT'">
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each select="cac:Delivery/cac:DeliveryTerms/cbc:ID[@schemeID='INCOTERMS']">
						<xsl:text>&#160;</xsl:text>
						<xsl:apply-templates/>
					</xsl:for-each>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each select="cac:Delivery/cac:Shipment/cac:TransportHandlingUnit/cac:ActualPackage/cbc:PackagingTypeCode">
						<xsl:text>&#160;</xsl:text>
						<xsl:call-template name="Packaging">
							<xsl:with-param name="PackagingType">
								<xsl:value-of select="."/>
							</xsl:with-param>
						</xsl:call-template>
					</xsl:for-each>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each select="cac:Delivery/cac:Shipment/cac:TransportHandlingUnit/cac:ActualPackage/cbc:ID">
						<xsl:text>&#160;</xsl:text>
						<xsl:apply-templates/>
					</xsl:for-each>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each select="cac:Delivery/cac:Shipment/cac:TransportHandlingUnit/cac:ActualPackage/cbc:Quantity">
						<xsl:text>&#160;</xsl:text>
						<xsl:apply-templates/>
					</xsl:for-each>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each select="cac:Delivery/cac:DeliveryAddress">
						<xsl:text>&#160;</xsl:text>
						<xsl:apply-templates select="."/>
					</xsl:for-each>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each select="cac:Delivery/cac:Shipment/cac:ShipmentStage/cbc:TransportModeCode">
						<xsl:text>&#160;</xsl:text>
						<xsl:call-template name="TransportMode">
							<xsl:with-param name="TransportModeType">
								<xsl:value-of select="."/>
							</xsl:with-param>
						</xsl:call-template>
					</xsl:for-each>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
					<xsl:for-each select="cac:Delivery/cac:Shipment/cac:GoodsItem/cbc:RequiredCustomsID">
						<xsl:text>&#160;</xsl:text>
						<xsl:apply-templates/>
					</xsl:for-each>
				</td>
			</xsl:if>
		</tr>
	</xsl:template>
	<xsl:template match="//n1:Invoice/cac:InvoiceLine/cac:Delivery/cac:DeliveryAddress">
		<xsl:text>&#160;</xsl:text>
		<xsl:value-of select="cbc:CityName"/>
		<xsl:text>&#160;</xsl:text>
		<xsl:value-of select="cbc:CitySubdivisionName"/>
		<xsl:text>&#160;</xsl:text>
		<xsl:value-of select="cac:Country/cbc:Name"/>
	</xsl:template>
	<xsl:template match="//cbc:IssueDate">
		<xsl:value-of select="substring(.,9,2)"/>-<xsl:value-of select="substring(.,6,2)"/>-<xsl:value-of select="substring(.,1,4)"/>
	</xsl:template>
	<xsl:template match="//n1:Invoice">
		<tr id="lineTableTr">
			<td id="lineTableTd">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
			</td>
			<td id="lineTableTd" align="right">
				<xsl:text>&#160;</xsl:text>
			</td>
			<xsl:if
				test="//n1:Invoice/cbc:ProfileID='HKS'">
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
			</xsl:if>
			<xsl:if
				test="//n1:Invoice/cbc:ProfileID='HKS' and /n1:Invoice/cbc:InvoiceTypeCode='SATIS'">
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
			</xsl:if>
			<xsl:if test="//n1:Invoice/cbc:ProfileID='IHRACAT'">
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
				<td class="lineTableTd" align="right">
					<xsl:text>&#160;</xsl:text>
				</td>
			</xsl:if>
		</tr>
	</xsl:template>
	<xsl:template match="//n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount">
		<tr id="accountTableTr">
			<td id="accountTableTd">
				<span>
					<xsl:text>&#160;</xsl:text>
					<xsl:value-of select="./cbc:ID"/>
				</span>
			</td>
			<td id="accountTableTd">
				<span>
					<xsl:text>&#160;</xsl:text>
					<xsl:value-of select="./cbc:CurrencyCode"/>
				</span>
			</td>
			<td id="accountTableTd">
				<span>
					<xsl:text>&#160;</xsl:text>
					<xsl:value-of select="./cbc:PaymentNote"/>
				</span>
			</td>
		</tr>
	</xsl:template>
	<xsl:template name="Party_Title" >
		<xsl:param name="PartyType" />
		<td style="width:469px; " align="left">
			<xsl:if test="cac:PartyName">
				<xsl:value-of select="cac:PartyName/cbc:Name"/>
				<br/>
			</xsl:if>
			<xsl:if test="cac:PartyTaxScheme">
				<xsl:value-of select="cac:PartyTaxScheme/cbc:CompanyId"/>
				<br/>
			</xsl:if>
			<xsl:for-each select="cac:Person">
				<xsl:for-each select="cbc:Title">
					<xsl:apply-templates/>
					<xsl:text>&#160;</xsl:text>
				</xsl:for-each>
				<xsl:for-each select="cbc:FirstName">
					<xsl:apply-templates/>
					<xsl:text>&#160;</xsl:text>
				</xsl:for-each>
				<xsl:for-each select="cbc:MiddleName">
					<xsl:apply-templates/>
					<xsl:text>&#160; </xsl:text>
				</xsl:for-each>
				<xsl:for-each select="cbc:FamilyName">
					<xsl:apply-templates/>
					<xsl:text>&#160;</xsl:text>
				</xsl:for-each>
				<xsl:for-each select="cbc:NameSuffix">
					<xsl:apply-templates/>
				</xsl:for-each>
				<xsl:if test="$PartyType='TAXFREE'">
					<br/>
					<xsl:text>Pasaport No: </xsl:text>
					<xsl:value-of select="cac:IdentityDocumentReference/cbc:ID"/>
					<br/>
					<xsl:text>Ülkesi: </xsl:text>
					<xsl:value-of select="cbc:NationalityID"/>
				</xsl:if>
			</xsl:for-each>
		</td>
	</xsl:template>
	<xsl:template name="Party_Adress" >
		<xsl:param name="PartyType" />
		<td style="width:469px; " align="left">
			<xsl:for-each select="cac:PostalAddress">
				<xsl:for-each select="cbc:StreetName">
					<xsl:apply-templates/>
					<xsl:text>&#160;</xsl:text>
				</xsl:for-each>
				<xsl:for-each select="cbc:BuildingName">
					<xsl:apply-templates/>
				</xsl:for-each>
				<xsl:if test="cbc:BuildingNumber != ''">
          <xsl:text> No:</xsl:text>
		  <xsl:for-each select="cbc:BuildingNumber">
          <xsl:apply-templates/>          
        </xsl:for-each>
		<xsl:text>&#160;</xsl:text>
		</xsl:if>
				<br/>
				<xsl:for-each select="cbc:PostalZone">
					<xsl:apply-templates/>
					<xsl:text>&#160;</xsl:text>
				</xsl:for-each>
				<xsl:for-each select="cbc:CitySubdivisionName">
					<xsl:apply-templates/>
					<xsl:text>/ </xsl:text>
				</xsl:for-each>
				<xsl:for-each select="cbc:CityName">
					<xsl:apply-templates/>
					<xsl:text>&#160;</xsl:text>
				</xsl:for-each>
				<xsl:if test="$PartyType='TAXFREE' or $PartyType='EXPORT'">
					<br/>
					<xsl:value-of select="cac:Country/cbc:Name"/>
					<br/>
				</xsl:if>
			</xsl:for-each>
		</td>
	</xsl:template>
	<xsl:template name='Party_Other'>
		<xsl:param name="PartyType" />
		<xsl:for-each select="cbc:WebsiteURI">
			<tr align="left">
				<td>
					<xsl:text>Web Sitesi: </xsl:text>
					<xsl:value-of select="."/>
				</td>
			</tr>
		</xsl:for-each>
		<xsl:for-each select="cac:Contact/cbc:ElectronicMail">
			<tr align="left">
				<td>
					<xsl:text>E-Posta: </xsl:text>
					<xsl:value-of select="."/>
				</td>
			</tr>
		</xsl:for-each>
		<xsl:for-each select="cac:Contact">
			<xsl:if test="cbc:Telephone or cbc:Telefax">
				<tr align="left">
					<td style="width:469px; " align="left">
						<xsl:for-each select="cbc:Telephone">
							<xsl:text>Tel: </xsl:text>
							<xsl:apply-templates/>
						</xsl:for-each>
						<xsl:for-each select="cbc:Telefax">
							<xsl:text> Fax: </xsl:text>
							<xsl:apply-templates/>
						</xsl:for-each>
						<xsl:text>&#160;</xsl:text>
					</td>
				</tr>
			</xsl:if>
		</xsl:for-each>
		<xsl:if test="$PartyType!='TAXFREE' and $PartyType!='EXPORT'">
			<xsl:for-each select="cac:PartyTaxScheme/cac:TaxScheme/cbc:Name">
				<tr align="left">
					<td>
						<xsl:text>Vergi Dairesi: </xsl:text>
						<xsl:apply-templates/>
					</td>
				</tr>
			</xsl:for-each>
			<xsl:for-each select="cac:PartyIdentification">
				<tr align="left">
					<td>
						<xsl:value-of select="cbc:ID/@schemeID"/>
						<xsl:text>: </xsl:text>
						<xsl:value-of select="cbc:ID"/>
					</td>
				</tr>
			</xsl:for-each>
		</xsl:if>

		<xsl:if test="$PartyType='EXPORT'">
		<xsl:for-each select="cac:PartyLegalEntity/cbc:CompanyID">
				<tr align="left">
					<td>
						<xsl:text>VKN: </xsl:text>
						<xsl:apply-templates/>
					</td>
				</tr>
			</xsl:for-each>
		</xsl:if>
	</xsl:template>
	<xsl:template name="Curr_Type">
		<xsl:value-of select="format-number(., '###.##0,00', 'european')"/>
		<xsl:if	test="@currencyID">
			<xsl:text/>
			<xsl:choose>
				<xsl:when test="@currencyID = 'TRL' or @currencyID = 'TRY'">
					<xsl:text>TL</xsl:text>
				</xsl:when>
				<xsl:otherwise>
					<xsl:value-of select="@currencyID"/>
				</xsl:otherwise>
			</xsl:choose>
		</xsl:if>
	</xsl:template>
	<xsl:template name="TransportMode">
		<xsl:param name="TransportModeType" />
		<xsl:choose>
			<xsl:when test="$TransportModeType=1">Denizyolu</xsl:when>
			<xsl:when test="$TransportModeType=2">Demiryolu</xsl:when>
			<xsl:when test="$TransportModeType=3">Karayolu</xsl:when>
			<xsl:when test="$TransportModeType=4">Havayolu</xsl:when>
			<xsl:when test="$TransportModeType=5">Posta</xsl:when>
			<xsl:when test="$TransportModeType=6">Çok araçlı</xsl:when>
			<xsl:when test="$TransportModeType=7">Sabit taşıma tesisleri</xsl:when>
			<xsl:when test="$TransportModeType=8">İç su taşımacılığı</xsl:when>
			<xsl:otherwise>
				<xsl:value-of select="$TransportModeType"/>
			</xsl:otherwise>
		</xsl:choose>
	</xsl:template>
	<xsl:template name="Packaging">
		<xsl:param name="PackagingType" />
		<xsl:choose>
			<xsl:when test="$PackagingType='1A'">Bidon, Çelik</xsl:when>
			<xsl:when test="$PackagingType='1B'">Bidon, Alüminyum</xsl:when>
			<xsl:when test="$PackagingType='1D'">Bidon, Kontrplak</xsl:when>
			<xsl:when test="$PackagingType='1F'">Konteyner, Esnek</xsl:when>
			<xsl:when test="$PackagingType='1G'">Bidon, Fiber</xsl:when>
			<xsl:when test="$PackagingType='1W'">Bidon, Ahşap</xsl:when>
			<xsl:when test="$PackagingType='2C'">Varil, Ahşap</xsl:when>
			<xsl:when test="$PackagingType='3A'">Yakıt Bidonu, Çelik</xsl:when>
			<xsl:when test="$PackagingType='3H'">Yakıt Bidonu, Plastik</xsl:when>
			<xsl:when test="$PackagingType='43'">Torba (Bag), Super Bulk</xsl:when>
			<xsl:when test="$PackagingType='44'">Torba (Bag), Çoklu Torba</xsl:when>
			<xsl:when test="$PackagingType='4A'">Kutu, Çelik</xsl:when>
			<xsl:when test="$PackagingType='4B'">Kutu, Alüminyum</xsl:when>
			<xsl:when test="$PackagingType='4C'">Kutu, Doğal Ahşap</xsl:when>
			<xsl:when test="$PackagingType='4D'">Kutu, Kontrplak</xsl:when>
			<xsl:when test="$PackagingType='4F'">Kutu, Birleştirilmiş Ahşap</xsl:when>
			<xsl:when test="$PackagingType='4G'">Kutu, Elyaftahta</xsl:when>
			<xsl:when test="$PackagingType='4H'">Kutu, Plastik</xsl:when>
			<xsl:when test="$PackagingType='5H'">Torba (Bag), Dokuma Plastik</xsl:when>
			<xsl:when test="$PackagingType='5L'">Torba (Bag), Tekstil</xsl:when>
			<xsl:when test="$PackagingType='5M'">Torba (Bag), Kağıt</xsl:when>
			<xsl:when test="$PackagingType='6H'">Kompozit Ambalaj, Plastik Hazne</xsl:when>
			<xsl:when test="$PackagingType='6P'">Kompozit Ambalaj, Cam Hazne</xsl:when>
			<xsl:when test="$PackagingType='7A'">Mahfaza, Araba içi taşıyıcı</xsl:when>
			<xsl:when test="$PackagingType='7B'">Mahfaza, Ahşap</xsl:when>
			<xsl:when test="$PackagingType='8A'">Palet, Ahşap</xsl:when>
			<xsl:when test="$PackagingType='8B'">Kasa (Crate), Ahşap</xsl:when>
			<xsl:when test="$PackagingType='8C'">Tomar (Bundle), ahşap</xsl:when>
			<xsl:when test="$PackagingType='AA'">Ara Dolum Konteyneri, Sert Plastik</xsl:when>
			<xsl:when test="$PackagingType='AB'">Hazne, Fiber</xsl:when>
			<xsl:when test="$PackagingType='AC'">Hazne, Kağıt</xsl:when>
			<xsl:when test="$PackagingType='AD'">Hazne, Ağaç</xsl:when>
			<xsl:when test="$PackagingType='AE'">Aerosol</xsl:when>
			<xsl:when test="$PackagingType='AF'">Palet, modüler, 80x60</xsl:when>
			<xsl:when test="$PackagingType='AG'">Palet, Streç Filmli</xsl:when>
			<xsl:when test="$PackagingType='AH'">Palet, 100x110</xsl:when>
			<xsl:when test="$PackagingType='AI'">İstiridye Kabuğu</xsl:when>
			<xsl:when test="$PackagingType='AJ'">Koni</xsl:when>
			<xsl:when test="$PackagingType='AL'">Top (Küre)</xsl:when>
			<xsl:when test="$PackagingType='AM'">Ampul, Korumasız</xsl:when>
			<xsl:when test="$PackagingType='AP'">Ampul, Korumalı</xsl:when>
			<xsl:when test="$PackagingType='AT'">Atomizer</xsl:when>
			<xsl:when test="$PackagingType='AV'">Kapsül</xsl:when>
			<xsl:when test="$PackagingType='B4'">Kemer/Kayış</xsl:when>
			<xsl:when test="$PackagingType='BA'">Varil (Barrel)</xsl:when>
			<xsl:when test="$PackagingType='BB'">Bobin (Bobbin)</xsl:when>
			<xsl:when test="$PackagingType='BC'">Şişe Kasası</xsl:when>
			<xsl:when test="$PackagingType='BD'">Pano (Board)</xsl:when>
			<xsl:when test="$PackagingType='BE'">Tomar/Bohça (Bundle)</xsl:when>
			<xsl:when test="$PackagingType='BF'">Balon, Korumasız</xsl:when>
			<xsl:when test="$PackagingType='BG'">Torba (Bag)</xsl:when>
			<xsl:when test="$PackagingType='BH'">Demet-Deste</xsl:when>
			<xsl:when test="$PackagingType='BI'">Çöp Kutusu</xsl:when>
			<xsl:when test="$PackagingType='BJ'">Kova</xsl:when>
			<xsl:when test="$PackagingType='BK'">Sepet</xsl:when>
			<xsl:when test="$PackagingType='BL'">Balya, Sıkıştırılmış</xsl:when>
			<xsl:when test="$PackagingType='BM'">Havza</xsl:when>
			<xsl:when test="$PackagingType='BN'">Balya, Sıkıştırılmamış</xsl:when>
			<xsl:when test="$PackagingType='BO'">Şişe, Korumasız, Silindirik</xsl:when>
			<xsl:when test="$PackagingType='BP'">Balon, Korumalı</xsl:when>
			<xsl:when test="$PackagingType='BQ'">Şişe, Korumalı, Silindirik</xsl:when>
			<xsl:when test="$PackagingType='BR'">Bar</xsl:when>
			<xsl:when test="$PackagingType='BS'">Şişe, Korumasız, Soğan Biçimli</xsl:when>
			<xsl:when test="$PackagingType='BT'">Sürgü-Cıvata</xsl:when>
			<xsl:when test="$PackagingType='BU'">İzmarit-Sap-Dip</xsl:when>
			<xsl:when test="$PackagingType='BV'">Şişe, Korumalı, Soğan Biçimli</xsl:when>
			<xsl:when test="$PackagingType='BW'">Kutu, Sıvıya Özel</xsl:when>
			<xsl:when test="$PackagingType='BX'">Kutu</xsl:when>
			<xsl:when test="$PackagingType='BY'">Pano (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='BZ'">Bar (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='CA'">Teneke Kutu, Dikdörtgen</xsl:when>
			<xsl:when test="$PackagingType='CB'">Bira kasası</xsl:when>
			<xsl:when test="$PackagingType='CC'">Güğüm</xsl:when>
			<xsl:when test="$PackagingType='CD'">Teneke Kutu, saplı ve ağızlı</xsl:when>
			<xsl:when test="$PackagingType='CE'">Balık küfesi</xsl:when>
			<xsl:when test="$PackagingType='CF'">Sandık (Coffer)</xsl:when>
			<xsl:when test="$PackagingType='CG'">Kafes</xsl:when>
			<xsl:when test="$PackagingType='CH'">Sandık (Chest)</xsl:when>
			<xsl:when test="$PackagingType='CI'">Teneke Muhafaza (Canister)</xsl:when>
			<xsl:when test="$PackagingType='CJ'">Tabut</xsl:when>
			<xsl:when test="$PackagingType='CK'">Fıçı</xsl:when>
			<xsl:when test="$PackagingType='CL'">Bobin (Coil)</xsl:when>
			<xsl:when test="$PackagingType='CM'">Kart (Card)</xsl:when>
			<xsl:when test="$PackagingType='CN'">Konteyner (nakliye teçhizatı olarak belirtilmemiş ise)</xsl:when>
			<xsl:when test="$PackagingType='CO'">Damacana, Korumasız</xsl:when>
			<xsl:when test="$PackagingType='CP'">Damacana, Korumalı</xsl:when>
			<xsl:when test="$PackagingType='CQ'">Kartuş</xsl:when>
			<xsl:when test="$PackagingType='CR'">Kasa (Crate)</xsl:when>
			<xsl:when test="$PackagingType='CS'">Mahfaza</xsl:when>
			<xsl:when test="$PackagingType='CT'">Karton Kutu</xsl:when>
			<xsl:when test="$PackagingType='CU'">Kupa</xsl:when>
			<xsl:when test="$PackagingType='CV'">Kuver (Cover)</xsl:when>
			<xsl:when test="$PackagingType='CW'">Kafes, Rulo</xsl:when>
			<xsl:when test="$PackagingType='CX'">Teneke Kutu, Silindirik</xsl:when>
			<xsl:when test="$PackagingType='CY'">Silindir</xsl:when>
			<xsl:when test="$PackagingType='CZ'">Çadır Bezi</xsl:when>
			<xsl:when test="$PackagingType='DA'">Kasa (Crate), Çok katmanlı, Plastik</xsl:when>
			<xsl:when test="$PackagingType='DB'">Kasa (Crate), Çok katmanlı, Ahşap</xsl:when>
			<xsl:when test="$PackagingType='DC'">Kasa (Crate), Çok katmanlı, Mukavva</xsl:when>
			<xsl:when test="$PackagingType='DG'">Kafes (CHEP)</xsl:when>
			<xsl:when test="$PackagingType='DH'">Kutu (CHEP)</xsl:when>
			<xsl:when test="$PackagingType='DI'">Bidon, Demir</xsl:when>
			<xsl:when test="$PackagingType='DJ'">Hasır Kaplı Damacana, Korumasız</xsl:when>
			<xsl:when test="$PackagingType='DK'">Kasa (Crate), yığın, mukavva</xsl:when>
			<xsl:when test="$PackagingType='DL'">Kasa (Crate), yığın, Plastik</xsl:when>
			<xsl:when test="$PackagingType='DM'">Kasa (Crate), yığın, ahşap</xsl:when>
			<xsl:when test="$PackagingType='DN'">Dağıtıcı (Dispenser)</xsl:when>
			<xsl:when test="$PackagingType='DP'">Hasır Kaplı Damacana, Korumalı</xsl:when>
			<xsl:when test="$PackagingType='DR'">Bidon</xsl:when>
			<xsl:when test="$PackagingType='DS'">Tabla, Kaplamasız Tek Katlı, Plastik</xsl:when>
			<xsl:when test="$PackagingType='DT'">Tabla, Kaplamasız Tek Katlı, Ahşap</xsl:when>
			<xsl:when test="$PackagingType='DU'">Tabla, Kaplamasız Tek Katlı, Polisitren</xsl:when>
			<xsl:when test="$PackagingType='DV'">Tabla, Kaplamasız Tek Katlı, Mukavva</xsl:when>
			<xsl:when test="$PackagingType='DW'">Tabla, Kaplamasız İki Katlı, Plastik</xsl:when>
			<xsl:when test="$PackagingType='DX'">Tabla, Kaplamasız İki Katlı, Ahşap</xsl:when>
			<xsl:when test="$PackagingType='DY'">Tabla, Kaplamasız İki Katlı, Mukavva</xsl:when>
			<xsl:when test="$PackagingType='EC'">Torba (Bag), Plastik</xsl:when>
			<xsl:when test="$PackagingType='ED'">Mahfaza, Paletli</xsl:when>
			<xsl:when test="$PackagingType='EE'">Mahfaza, Paletli, Ahşap</xsl:when>
			<xsl:when test="$PackagingType='EF'">Mahfaza, Paletli, Mukavva</xsl:when>
			<xsl:when test="$PackagingType='EG'">Mahfaza, Paletli, Plastik</xsl:when>
			<xsl:when test="$PackagingType='EH'">Mahfaza, Paletli, Metal</xsl:when>
			<xsl:when test="$PackagingType='EI'">Mahfaza, İzotermik</xsl:when>
			<xsl:when test="$PackagingType='EN'">Zarf</xsl:when>
			<xsl:when test="$PackagingType='FB'">Flexibag</xsl:when>
			<xsl:when test="$PackagingType='FC'">Kasa (Crate), Meyve</xsl:when>
			<xsl:when test="$PackagingType='FD'">Kasa (Crate), Çerçeveli</xsl:when>
			<xsl:when test="$PackagingType='FE'">Flexitank</xsl:when>
			<xsl:when test="$PackagingType='FI'">Küçük fıçı (Firkin)</xsl:when>
			<xsl:when test="$PackagingType='FL'">Cep Şişesi</xsl:when>
			<xsl:when test="$PackagingType='FO'">Ayakkabı Dolabı</xsl:when>
			<xsl:when test="$PackagingType='FP'">Filmpack</xsl:when>
			<xsl:when test="$PackagingType='FR'">Çerçeve</xsl:when>
			<xsl:when test="$PackagingType='FT'">Foodtainer</xsl:when>
			<xsl:when test="$PackagingType='FW'">Taşıyıcı, Düz Yataklı</xsl:when>
			<xsl:when test="$PackagingType='FX'">Torba (Bag), Esnek konteynerli</xsl:when>
			<xsl:when test="$PackagingType='GB'">Şişe, Gaz</xsl:when>
			<xsl:when test="$PackagingType='GI'">Kiriş</xsl:when>
			<xsl:when test="$PackagingType='GL'">Konteyner, Galon</xsl:when>
			<xsl:when test="$PackagingType='GR'">Hazne, Cam</xsl:when>
			<xsl:when test="$PackagingType='GU'">Tabla, yatay istiflenmiş düz nesneler</xsl:when>
			<xsl:when test="$PackagingType='GY'">Torba (Bag), Çul</xsl:when>
			<xsl:when test="$PackagingType='GZ'">Kirişler (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='HA'">Sepet, saplı, Plastik</xsl:when>
			<xsl:when test="$PackagingType='HB'">Sepet, saplı, ahşap</xsl:when>
			<xsl:when test="$PackagingType='HC'">Sepet, saplı, mukavva</xsl:when>
			<xsl:when test="$PackagingType='HG'">Büyük Fıçı</xsl:when>
			<xsl:when test="$PackagingType='HN'">Askı</xsl:when>
			<xsl:when test="$PackagingType='HR'">Kapaklı Sepet</xsl:when>
			<xsl:when test="$PackagingType='IA'">Koli, Ekran, Ahşap</xsl:when>
			<xsl:when test="$PackagingType='IB'">Koli, Ekran, Mukavva</xsl:when>
			<xsl:when test="$PackagingType='IC'">Koli, Ekran, Plastik</xsl:when>
			<xsl:when test="$PackagingType='ID'">Koli, Ekran, Metal</xsl:when>
			<xsl:when test="$PackagingType='IE'">Koli, Teşhir</xsl:when>
			<xsl:when test="$PackagingType='IF'">Koli, Sürekli (Sosis gibi)</xsl:when>
			<xsl:when test="$PackagingType='IG'">Koli, kağıt sarılı</xsl:when>
			<xsl:when test="$PackagingType='IH'">Bidon, Plastik</xsl:when>
			<xsl:when test="$PackagingType='IK'">Koli, kavrama delikli mukavva</xsl:when>
			<xsl:when test="$PackagingType='IL'">Tabla, sabit, kapaklı, istiflenebilir (CEN-TS 14482:2002)</xsl:when>
			<xsl:when test="$PackagingType='IN'">Külçe</xsl:when>
			<xsl:when test="$PackagingType='IZ'">Külçe (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='JB'">Torba (Bag), Jumbo</xsl:when>
			<xsl:when test="$PackagingType='JC'">Yakıt Bidonu, Dikdörtgen</xsl:when>
			<xsl:when test="$PackagingType='JG'">Sürahi</xsl:when>
			<xsl:when test="$PackagingType='JR'">Kavanoz</xsl:when>
			<xsl:when test="$PackagingType='JT'">Jüt Torba</xsl:when>
			<xsl:when test="$PackagingType='JY'">Yakıt Bidonu, Silindirik</xsl:when>
			<xsl:when test="$PackagingType='KG'">Fıçı (KEG)</xsl:when>
			<xsl:when test="$PackagingType='KI'">Kit</xsl:when>
			<xsl:when test="$PackagingType='LE'">Kişisel Bagaj</xsl:when>
			<xsl:when test="$PackagingType='LG'">Kütük</xsl:when>
			<xsl:when test="$PackagingType='LT'">Hisse</xsl:when>
			<xsl:when test="$PackagingType='LU'">Kulp (Lug)</xsl:when>
			<xsl:when test="$PackagingType='LV'">Liftvan</xsl:when>
			<xsl:when test="$PackagingType='LZ'">Kütükler (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='MA'">Kasa (Crate), Metal</xsl:when>
			<xsl:when test="$PackagingType='MB'">Torba (Bag), Çoklu</xsl:when>
			<xsl:when test="$PackagingType='MC'">Kasa (Crate), Süt</xsl:when>
			<xsl:when test="$PackagingType='ME'">Konteyner, Metal</xsl:when>
			<xsl:when test="$PackagingType='MR'">Hazne, Metal</xsl:when>
			<xsl:when test="$PackagingType='MS'">Çuval/Torba (Sack), Çok Katmanlı</xsl:when>
			<xsl:when test="$PackagingType='MT'">Mat</xsl:when>
			<xsl:when test="$PackagingType='MW'">Hazne, Plastik Sarılı</xsl:when>
			<xsl:when test="$PackagingType='MX'">Kibrit Kutusu</xsl:when>
			<xsl:when test="$PackagingType='NA'">TANIMSIZ</xsl:when>
			<xsl:when test="$PackagingType='NE'">Paketsiz/Ambalajsız</xsl:when>
			<xsl:when test="$PackagingType='NF'">Paketsiz, Tekli</xsl:when>
			<xsl:when test="$PackagingType='NG'">Paketsiz, Çoklu</xsl:when>
			<xsl:when test="$PackagingType='NS'">İç içe</xsl:when>
			<xsl:when test="$PackagingType='NT'">Ağ</xsl:when>
			<xsl:when test="$PackagingType='NU'">Ağ, tüp, plastik</xsl:when>
			<xsl:when test="$PackagingType='NV'">Ağ, tüp, tekstil</xsl:when>
			<xsl:when test="$PackagingType='OA'">Palet, CHEP 40x60</xsl:when>
			<xsl:when test="$PackagingType='OB'">Palet, CHEP 80x120</xsl:when>
			<xsl:when test="$PackagingType='OC'">Palet, CHEP 100x120</xsl:when>
			<xsl:when test="$PackagingType='OD'">Palet, AS 4068-1993</xsl:when>
			<xsl:when test="$PackagingType='OE'">Palet, ISO T11</xsl:when>
			<xsl:when test="$PackagingType='OF'">Platform, Belirsiz ağırlık ve boyut</xsl:when>
			<xsl:when test="$PackagingType='OK'">Blok (mesela granit)</xsl:when>
			<xsl:when test="$PackagingType='OT'">Octabin</xsl:when>
			<xsl:when test="$PackagingType='OU'">Konteyner, Dış yüzey</xsl:when>
			<xsl:when test="$PackagingType='P2'">Pan</xsl:when>
			<xsl:when test="$PackagingType='PA'">Küçük Koli (Packet)</xsl:when>
			<xsl:when test="$PackagingType='PB'">Palet + Kutu</xsl:when>
			<xsl:when test="$PackagingType='PC'">Parsel</xsl:when>
			<xsl:when test="$PackagingType='PD'">Palet 80x100 (PD)</xsl:when>
			<xsl:when test="$PackagingType='PE'">Palet 80x120</xsl:when>
			<xsl:when test="$PackagingType='PF'">Ağıl (Pen)</xsl:when>
			<xsl:when test="$PackagingType='PG'">Plaka/Levha</xsl:when>
			<xsl:when test="$PackagingType='PH'">Sürahi (Pitcher)</xsl:when>
			<xsl:when test="$PackagingType='PI'">Boru</xsl:when>
			<xsl:when test="$PackagingType='PJ'">Meyve Sepeti</xsl:when>
			<xsl:when test="$PackagingType='PK'">Paket (Stadart)</xsl:when>
			<xsl:when test="$PackagingType='PL'">Kova</xsl:when>
			<xsl:when test="$PackagingType='PN'">Kalas/Parke</xsl:when>
			<xsl:when test="$PackagingType='PO'">Kese</xsl:when>
			<xsl:when test="$PackagingType='PP'">Parça</xsl:when>
			<xsl:when test="$PackagingType='PR'">Hazne, Plastik</xsl:when>
			<xsl:when test="$PackagingType='PT'">Kap</xsl:when>
			<xsl:when test="$PackagingType='PU'">Tabla</xsl:when>
			<xsl:when test="$PackagingType='PV'">Borular (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='PX'">Palet</xsl:when>
			<xsl:when test="$PackagingType='PY'">Paletler (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='PZ'">Kalas/Parke (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='QA'">Bidon, Çelik, Başlığı çıkarılamaz</xsl:when>
			<xsl:when test="$PackagingType='QB'">Bidon, Çelik, Başlığı çıkarılabilir</xsl:when>
			<xsl:when test="$PackagingType='QC'">Bidon, Alüminyum, Başlığı çıkarılamaz</xsl:when>
			<xsl:when test="$PackagingType='QD'">Bidon, Alüminyum, Başlığı çıkarılabilir</xsl:when>
			<xsl:when test="$PackagingType='QF'">Bidon, Plastik, Başlığı çıkarılamaz</xsl:when>
			<xsl:when test="$PackagingType='QG'">Bidon, Plastik, Başlığı çıkarılabilir</xsl:when>
			<xsl:when test="$PackagingType='QH'">Varil, Ahşap, tente tipi</xsl:when>
			<xsl:when test="$PackagingType='QJ'">Varil, Ahşap, başlığı çıkarılabilir</xsl:when>
			<xsl:when test="$PackagingType='QK'">Yakıt Bidonu, Çelik, başlığı çıkarılamaz</xsl:when>
			<xsl:when test="$PackagingType='QL'">Yakıt Bidonu, Çelik, başlığı çıkarılabilir</xsl:when>
			<xsl:when test="$PackagingType='QM'">Yakıt Bidonu, Plastik, başlığı çıkarılamaz</xsl:when>
			<xsl:when test="$PackagingType='QN'">Yakıt Bidonu, Plastik, başlığı çıkarılabilir</xsl:when>
			<xsl:when test="$PackagingType='QP'">Kutu, ahşap, doğal ağaç</xsl:when>
			<xsl:when test="$PackagingType='QQ'">Kutu, ahşap, doğal ağaç (sift proof walls)</xsl:when>
			<xsl:when test="$PackagingType='QR'">Kutu, plastik, genişletilmiş</xsl:when>
			<xsl:when test="$PackagingType='QS'">Kutu, plastik, katı</xsl:when>
			<xsl:when test="$PackagingType='RD'">Çubuk (Rod)</xsl:when>
			<xsl:when test="$PackagingType='RG'">Halka (Ring)</xsl:when>
			<xsl:when test="$PackagingType='RJ'">Raf, Giyim askısı</xsl:when>
			<xsl:when test="$PackagingType='RK'">Raf</xsl:when>
			<xsl:when test="$PackagingType='RL'">Makara/Bobin</xsl:when>
			<xsl:when test="$PackagingType='RO'">Rulo</xsl:when>
			<xsl:when test="$PackagingType='RT'">Rednet</xsl:when>
			<xsl:when test="$PackagingType='RZ'">Çubuklar (Rods) (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='SA'">Çuval (Sack)</xsl:when>
			<xsl:when test="$PackagingType='SB'">Slab</xsl:when>
			<xsl:when test="$PackagingType='SC'">Kasa (Crate), sığ</xsl:when>
			<xsl:when test="$PackagingType='SD'">İğ (Spindle)</xsl:when>
			<xsl:when test="$PackagingType='SE'">Deniz Sandığı</xsl:when>
			<xsl:when test="$PackagingType='SH'">Kesecik (Sachet)</xsl:when>
			<xsl:when test="$PackagingType='SI'">Takoz (Skid)</xsl:when>
			<xsl:when test="$PackagingType='SK'">Mahfaza, iskelet</xsl:when>
			<xsl:when test="$PackagingType='SL'">Slipsheet</xsl:when>
			<xsl:when test="$PackagingType='SM'">Sheetmetal </xsl:when>
			<xsl:when test="$PackagingType='SO'">Makara (Spool)</xsl:when>
			<xsl:when test="$PackagingType='SP'">Tabaka, plastik sarma</xsl:when>
			<xsl:when test="$PackagingType='SS'">Mahfaza, Çelik</xsl:when>
			<xsl:when test="$PackagingType='ST'">Tabaka</xsl:when>
			<xsl:when test="$PackagingType='SU'">Valiz/Bavul</xsl:when>
			<xsl:when test="$PackagingType='SV'">Zarf, Çelik</xsl:when>
			<xsl:when test="$PackagingType='SW'">Vakumlu film (Shrinkwrapped)</xsl:when>
			<xsl:when test="$PackagingType='SX'">Set</xsl:when>
			<xsl:when test="$PackagingType='SY'">Sleeve</xsl:when>
			<xsl:when test="$PackagingType='SZ'">Tabaka (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='T1'">Tablet</xsl:when>
			<xsl:when test="$PackagingType='TB'">Tub</xsl:when>
			<xsl:when test="$PackagingType='TC'">Tea-chest</xsl:when>
			<xsl:when test="$PackagingType='TD'">Tüp, Katlanır</xsl:when>
			<xsl:when test="$PackagingType='TE'">Tyre</xsl:when>
			<xsl:when test="$PackagingType='TG'">Tank Konteyner</xsl:when>
			<xsl:when test="$PackagingType='TI'">Üçlü seri (Tierce)</xsl:when>
			<xsl:when test="$PackagingType='TK'">Tank, Dikdörtgen</xsl:when>
			<xsl:when test="$PackagingType='TL'">Tub, with lid</xsl:when>
			<xsl:when test="$PackagingType='TN'">Teneke (Tin)</xsl:when>
			<xsl:when test="$PackagingType='TO'">Şarap Fıçısı (Tun)</xsl:when>
			<xsl:when test="$PackagingType='TR'">Trunk</xsl:when>
			<xsl:when test="$PackagingType='TS'">Truss</xsl:when>
			<xsl:when test="$PackagingType='TT'">Torba, Geniş (Bag, tote)</xsl:when>
			<xsl:when test="$PackagingType='TU'">Tüp (Tube)</xsl:when>
			<xsl:when test="$PackagingType='TV'">Tüp, ağızlıklı</xsl:when>
			<xsl:when test="$PackagingType='TW'">Palet, triwall</xsl:when>
			<xsl:when test="$PackagingType='TY'">Tank, Silindirik</xsl:when>
			<xsl:when test="$PackagingType='TZ'">Tüpler (Tomar/Demet/truss)</xsl:when>
			<xsl:when test="$PackagingType='UC'">Kafessiz (uncaged)</xsl:when>
			<xsl:when test="$PackagingType='UN'">Ünite</xsl:when>
			<xsl:when test="$PackagingType='VA'">Vat</xsl:when>
			<xsl:when test="$PackagingType='VG'">Yığın (Bulk), Gaz (at 1031 mbar and 15°C)</xsl:when>
			<xsl:when test="$PackagingType='VI'">Küçük şişe (Vial)</xsl:when>
			<xsl:when test="$PackagingType='VK'">Vanpack</xsl:when>
			<xsl:when test="$PackagingType='VL'">Yığın, Sıvı (Bulk, Liquid)</xsl:when>
			<xsl:when test="$PackagingType='VO'">Yığın, Katı, büyük parçalı (Bulk, Solid, Large Particles)</xsl:when>
			<xsl:when test="$PackagingType='VP'">Vakum Paketli (vacuum-packed)</xsl:when>
			<xsl:when test="$PackagingType='VQ'">Yığın, sıvılaştırılmış gaz Bulk, liquefied gas (at abnormal temperature/pressure)</xsl:when>
			<xsl:when test="$PackagingType='VN'">Vehicle</xsl:when>
			<xsl:when test="$PackagingType='VR'">Yığın, katı, granül parçalı</xsl:when>
			<xsl:when test="$PackagingType='VS'">Yığın, hurda metal</xsl:when>
			<xsl:when test="$PackagingType='VY'">Yığın, katı, ince parçalı</xsl:when>
			<xsl:when test="$PackagingType='WA'">Ara Dolum Konteyneri</xsl:when>
			<xsl:when test="$PackagingType='WB'">Hazır Şişe (Wickerbottle)</xsl:when>
			<xsl:when test="$PackagingType='WC'">Ara Dolum Konteyneri, Çelik</xsl:when>
			<xsl:when test="$PackagingType='WD'">Ara Dolum Konteyneri, Alüminyum</xsl:when>
			<xsl:when test="$PackagingType='WF'">Ara Dolum Konteyneri, Metal</xsl:when>
			<xsl:when test="$PackagingType='WG'">Ara Dolum Konteyneri, Çelik (pressurised > 10 kpa)</xsl:when>
			<xsl:when test="$PackagingType='WH'">Ara Dolum Konteyneri, Alüminyum (pressurised > 10 kpa)</xsl:when>
			<xsl:when test="$PackagingType='WJ'">Ara Dolum Konteyneri, Metal (pressurised > 10 kpa)</xsl:when>
			<xsl:when test="$PackagingType='WK'">Ara Dolum Konteyneri, Çelik, Sıvı</xsl:when>
			<xsl:when test="$PackagingType='WL'">Ara Dolum Konteyneri, Alüminyum, Sıvı</xsl:when>
			<xsl:when test="$PackagingType='WM'">Ara Dolum Konteyneri, Metal, Sıvı</xsl:when>
			<xsl:when test="$PackagingType='WN'">Ara Dolum Konteyneri, Dokuma Plastik, Kaplanmamış/Astarsız</xsl:when>
			<xsl:when test="$PackagingType='WP'">Ara Dolum Konteyneri, Dokuma Plastik, Kaplanmış</xsl:when>
			<xsl:when test="$PackagingType='WQ'">Ara Dolum Konteyneri, Dokuma Plastik, Astarlı</xsl:when>
			<xsl:when test="$PackagingType='WR'">Ara Dolum Konteyneri, Dokuma Plastik, Kaplanmış ve Astarlı</xsl:when>
			<xsl:when test="$PackagingType='WS'">Ara Dolum Konteyneri, plastik film</xsl:when>
			<xsl:when test="$PackagingType='WT'">Ara Dolum Konteyneri, Tekstil, Kaplanmamış/Astarsız</xsl:when>
			<xsl:when test="$PackagingType='WU'">Ara Dolum Konteyneri, Doğal ağaç, iç Astarlı</xsl:when>
			<xsl:when test="$PackagingType='WV'">Ara Dolum Konteyneri, Tekstil, Kaplanmış</xsl:when>
			<xsl:when test="$PackagingType='WW'">Ara Dolum Konteyneri, Tekstil, Astarlı</xsl:when>
			<xsl:when test="$PackagingType='WX'">Ara Dolum Konteyneri, Tekstil, Kaplanmış ve Astarlı</xsl:when>
			<xsl:when test="$PackagingType='WY'">Ara Dolum Konteyneri, Kontrplak, İç Astarlı</xsl:when>
			<xsl:when test="$PackagingType='WZ'">Ara Dolum Konteyneri, Birleştirilmiş ahşap, İç Astarlı</xsl:when>
			<xsl:when test="$PackagingType='XA'">Torba (Bag), dokuma plastik, kaplanmamış/astarsız</xsl:when>
			<xsl:when test="$PackagingType='XB'">Torba (Bag), dokuma plastik, sift proof</xsl:when>
			<xsl:when test="$PackagingType='XC'">Torba (Bag), dokuma plastik, su geçirmez</xsl:when>
			<xsl:when test="$PackagingType='XD'">Torba (Bag), dokuma plastik, plastik film</xsl:when>
			<xsl:when test="$PackagingType='XF'">Torba (Bag), tekstil, plastik film, kaplanmamış/astarsız</xsl:when>
			<xsl:when test="$PackagingType='XG'">Torba (Bag), tekstil, sift proof</xsl:when>
			<xsl:when test="$PackagingType='XH'">Torba (Bag), tekstil, su geçirmez</xsl:when>
			<xsl:when test="$PackagingType='XJ'">Torba (Bag), kağıt, çok katmanlı</xsl:when>
			<xsl:when test="$PackagingType='XK'">Torba (Bag), kağıt, çok katmanlı, su geçirmez</xsl:when>
			<xsl:when test="$PackagingType='YA'">Kompozit Ambalaj, çelik bidonda plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YB'">Kompozit Ambalaj, çelik kasada plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YC'">Kompozit Ambalaj, alüminyum bidonda plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YD'">Kompozit Ambalaj, alüminyum kasada plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YF'">Kompozit Ambalaj, ahşap kutuda plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YG'">Kompozit Ambalaj, kontrplak bidonda plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YH'">Kompozit Ambalaj, kontrplak kutuda plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YJ'">Kompozit Ambalaj, fiber bidonda plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YK'">Kompozit Ambalaj, elyaf kutuda plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YL'">Kompozit Ambalaj, plastik bidonda plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YM'">Kompozit Ambalaj, katı plastik kutuda plastik hazne</xsl:when>
			<xsl:when test="$PackagingType='YN'">Kompozit Ambalaj, çelik bidonda cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YP'">Kompozit Ambalaj, çelik kasa kutuda cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YQ'">Kompozit Ambalaj, alüminyum bidonda cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YR'">Kompozit Ambalaj, alüminyum kasada cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YS'">Kompozit Ambalaj, ahşap kutuda cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YT'">Kompozit Ambalaj, kontrplak bidonda cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YV'">Kompozit Ambalaj, hasır sepette cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YW'">Kompozit Ambalaj, fiber bidonda cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YX'">Kompozit Ambalaj, elyaf kutuda cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YY'">Kompozit Ambalaj, genişletilebilir plastik pakette cam hazne</xsl:when>
			<xsl:when test="$PackagingType='YZ'">Kompozit Ambalaj, katı plastik pakette cam hazne</xsl:when>
			<xsl:when test="$PackagingType='ZA'">Ara Dolum Konteyneri, kağıt, çok katmanlı</xsl:when>
			<xsl:when test="$PackagingType='ZB'">Torba (Bag), büyük</xsl:when>
			<xsl:when test="$PackagingType='ZC'">Ara Dolum Konteyneri, kağıt, çok katmanlı, su geçirmez</xsl:when>
			<xsl:when test="$PackagingType='ZD'">Ara Dolum Konteyneri, sert plastik, yapısal elemanlarla, katılar</xsl:when>
			<xsl:when test="$PackagingType='ZF'">Ara Dolum Konteyneri, sert plastik, ayaklı, katılar</xsl:when>
			<xsl:when test="$PackagingType='ZG'">Ara Dolum Konteyneri, sert plastik, yapısal elemanlarla, basınçlı</xsl:when>
			<xsl:when test="$PackagingType='ZH'">Ara Dolum Konteyneri, sert plastik, ayaklı, basınçlı</xsl:when>
			<xsl:when test="$PackagingType='ZJ'">Ara Dolum Konteyneri, sert plastik, yapısal elemanlarla, sıvılar</xsl:when>
			<xsl:when test="$PackagingType='ZK'">Ara Dolum Konteyneri, sert plastik, ayaklı, sıvılar</xsl:when>
			<xsl:when test="$PackagingType='ZL'">Ara Dolum Konteyneri, kompozit, sert plastik, katılar</xsl:when>
			<xsl:when test="$PackagingType='ZM'">Ara Dolum Konteyneri, kompozit, esnek plastik, katılar</xsl:when>
			<xsl:when test="$PackagingType='ZN'">Ara Dolum Konteyneri, kompozit, sert plastik, basınçlı</xsl:when>
			<xsl:when test="$PackagingType='ZP'">Ara Dolum Konteyneri, kompozit, esnek plastik, basınçlı</xsl:when>
			<xsl:when test="$PackagingType='ZQ'">Ara Dolum Konteyneri, kompozit, sert plastik, sıvılar</xsl:when>
			<xsl:when test="$PackagingType='ZR'">Ara Dolum Konteyneri, kompozit, esnek plastik, sıvılar</xsl:when>
			<xsl:when test="$PackagingType='ZS'">Ara Dolum Konteyneri, kompozit</xsl:when>
			<xsl:when test="$PackagingType='ZT'">Ara Dolum Konteyneri, elyaf</xsl:when>
			<xsl:when test="$PackagingType='ZU'">Ara Dolum Konteyneri, esnek</xsl:when>
			<xsl:when test="$PackagingType='ZV'">Ara Dolum Konteyneri, çelik harici metal</xsl:when>
			<xsl:when test="$PackagingType='ZW'">Ara Dolum Konteyneri, doğal ahşap</xsl:when>
			<xsl:when test="$PackagingType='ZX'">Ara Dolum Konteyneri, Kontrplak</xsl:when>
			<xsl:when test="$PackagingType='ZY'">Ara Dolum Konteyneri, birleştirilmiş ahşap</xsl:when>
			<xsl:when test="$PackagingType='ZZ'">Karşılıklı Tanımlanmış/Belirlenmiş</xsl:when>
			<xsl:otherwise>
				<xsl:value-of select="$PackagingType"/>
			</xsl:otherwise>
		</xsl:choose>
	</xsl:template>
</xsl:stylesheet>